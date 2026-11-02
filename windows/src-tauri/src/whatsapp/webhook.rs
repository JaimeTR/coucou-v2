// Local HTTP listener for the WhatsApp gateway's webhook: bound to 127.0.0.1 only, parses
// one request per connection, hands it to the caller, closes. No HTTP framework — tokio's
// own TcpListener is enough for one POST route, same approach as the Mac's hand-rolled
// NWListener parser (WhatsAppWebhook.swift).

use std::collections::HashMap;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::time::{timeout, Duration};

const MAX_BODY: usize = 1_000_000; // 1 MB cap — a webhook payload is small.
const IDLE_TIMEOUT: Duration = Duration::from_secs(10);

pub struct Request {
    pub method: String,
    pub path: String,
    pub headers: HashMap<String, String>,
    pub body: Vec<u8>,
}

pub struct Listener {
    stop_tx: Option<tokio::sync::oneshot::Sender<()>>,
}

impl Listener {
    pub fn new() -> Self {
        Self { stop_tx: None }
    }

    pub async fn start<F>(&mut self, port: u16, on_request: F) -> bool
    where
        F: Fn(Request) -> u16 + Send + Sync + 'static,
    {
        self.stop();
        if port == 0 {
            return false;
        }
        let listener = match TcpListener::bind(("127.0.0.1", port)).await {
            Ok(l) => l,
            Err(_) => return false,
        };
        let (stop_tx, mut stop_rx) = tokio::sync::oneshot::channel();
        self.stop_tx = Some(stop_tx);
        let handler = Arc::new(on_request);
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = &mut stop_rx => break,
                    accepted = listener.accept() => {
                        let Ok((stream, peer)) = accepted else { continue };
                        if !peer.ip().is_loopback() {
                            continue;
                        }
                        let handler = handler.clone();
                        tokio::spawn(async move {
                            let _ = serve(stream, handler).await;
                        });
                    }
                }
            }
        });
        true
    }

    pub fn stop(&mut self) {
        if let Some(tx) = self.stop_tx.take() {
            let _ = tx.send(());
        }
    }
}

async fn serve<F>(mut stream: TcpStream, handler: Arc<F>) -> std::io::Result<()>
where
    F: Fn(Request) -> u16 + Send + Sync + 'static,
{
    let result = timeout(IDLE_TIMEOUT, read_request(&mut stream)).await;
    let status = match result {
        Ok(Ok(req)) => handler(req),
        Ok(Err(_)) => 400,
        Err(_) => 400, // timed out
    };
    let reason = match status {
        200 => "OK",
        401 => "Unauthorized",
        404 => "Not Found",
        _ => "Error",
    };
    let response = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(response.as_bytes()).await?;
    Ok(())
}

async fn read_request(stream: &mut TcpStream) -> std::io::Result<Request> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    let header_end = loop {
        let n = stream.read(&mut chunk).await?;
        if n == 0 {
            return Err(std::io::Error::new(std::io::ErrorKind::UnexpectedEof, "closed"));
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(pos) = find_header_end(&buf) {
            break pos;
        }
        if buf.len() > MAX_BODY {
            return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "headers too large"));
        }
    };

    let head = String::from_utf8_lossy(&buf[..header_end]).to_string();
    let mut lines = head.split("\r\n");
    let request_line = lines.next().unwrap_or("");
    let mut parts = request_line.split(' ');
    let method = parts.next().unwrap_or("").to_string();
    let path = parts.next().unwrap_or("").to_string();
    if method.is_empty() || path.is_empty() {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "bad request line"));
    }

    let mut headers = HashMap::new();
    let mut content_length = 0usize;
    for line in lines {
        if let Some((k, v)) = line.split_once(':') {
            let key = k.trim().to_lowercase();
            let val = v.trim().to_string();
            if key == "content-length" {
                content_length = val.parse().unwrap_or(0);
            }
            headers.insert(key, val);
        }
    }
    if content_length > MAX_BODY {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "body too large"));
    }

    let body_start = header_end + 4; // past "\r\n\r\n"
    let mut body = buf[body_start.min(buf.len())..].to_vec();
    while body.len() < content_length {
        let n = stream.read(&mut chunk).await?;
        if n == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..n]);
    }
    body.truncate(content_length);

    Ok(Request { method, path, headers, body })
}

fn find_header_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncWriteExt as _;
    use tokio::net::TcpStream as ClientStream;

    async fn free_port() -> u16 {
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        l.local_addr().unwrap().port()
    }

    #[tokio::test]
    async fn responds_200_for_a_well_formed_post_and_runs_the_handler() {
        let port = free_port().await;
        let mut listener = Listener::new();
        let got = std::sync::Arc::new(std::sync::Mutex::new(None));
        let got2 = got.clone();
        assert!(listener.start(port, move |req| {
            *got2.lock().unwrap() = Some((req.method.clone(), req.path.clone(), req.body.clone()));
            200
        }).await);

        tokio::time::sleep(Duration::from_millis(50)).await;
        let mut client = ClientStream::connect(("127.0.0.1", port)).await.unwrap();
        let request = b"POST /whatsapp HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 5\r\n\r\nhello";
        client.write_all(request).await.unwrap();
        let mut resp = Vec::new();
        use tokio::io::AsyncReadExt as _;
        let _ = tokio::time::timeout(Duration::from_secs(2), client.read_to_end(&mut resp)).await;
        assert!(String::from_utf8_lossy(&resp).starts_with("HTTP/1.1 200 OK"));

        tokio::time::sleep(Duration::from_millis(50)).await;
        let captured = got.lock().unwrap().clone().unwrap();
        assert_eq!(captured.0, "POST");
        assert_eq!(captured.1, "/whatsapp");
        assert_eq!(captured.2, b"hello");
        listener.stop();
    }

    #[tokio::test]
    async fn rejects_unknown_path_with_the_handlers_status() {
        let port = free_port().await;
        let mut listener = Listener::new();
        assert!(listener.start(port, |_req| 404).await);
        tokio::time::sleep(Duration::from_millis(50)).await;
        let mut client = ClientStream::connect(("127.0.0.1", port)).await.unwrap();
        client.write_all(b"GET /nope HTTP/1.1\r\nHost: x\r\nContent-Length: 0\r\n\r\n").await.unwrap();
        let mut resp = Vec::new();
        use tokio::io::AsyncReadExt as _;
        let _ = tokio::time::timeout(Duration::from_secs(2), client.read_to_end(&mut resp)).await;
        assert!(String::from_utf8_lossy(&resp).starts_with("HTTP/1.1 404 Not Found"));
        listener.stop();
    }

    #[tokio::test]
    async fn two_listeners_cannot_bind_the_same_port() {
        let port = free_port().await;
        let mut a = Listener::new();
        assert!(a.start(port, |_| 200).await);
        tokio::time::sleep(Duration::from_millis(20)).await;
        let mut b = Listener::new();
        assert!(!b.start(port, |_| 200).await);
        a.stop();
    }

    #[test]
    fn find_header_end_locates_the_blank_line() {
        assert_eq!(find_header_end(b"GET / HTTP/1.1\r\nHost: x\r\n\r\nbody"), Some(23));
        assert_eq!(find_header_end(b"incomplete"), None);
    }
}
