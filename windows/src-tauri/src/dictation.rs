// Dictation anywhere ("Flow"): hold a key, speak, let go — the words are pasted
// where you type.
//
// The design follows Louis Raillé's Flow (flow/ in the original app, MIT): a
// low-level keyboard hook that only watches and never swallows a key, and the
// words put on the clipboard (kept out of its history) with a Ctrl+V sent to the
// app in front. What differs: here the page records the voice and Groq's Whisper
// understands it (the same path as the chat microphone), where the original
// runs Parakeet offline on the CPU. So this one needs a Groq key and sends what
// you dictate to Groq; nothing else leaves the PC.

#[cfg(windows)]
mod imp {
    use std::sync::atomic::{AtomicU8, Ordering};
    use std::sync::mpsc::{channel, Sender};
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    use arboard::Clipboard;
    use tauri::{AppHandle, Emitter};
    use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::System::Threading::GetCurrentThreadId;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
        VIRTUAL_KEY,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, GetMessageW, PostThreadMessageW, SetWindowsHookExW, TranslateMessage,
        UnhookWindowsHookEx, KBDLLHOOKSTRUCT, LLKHF_INJECTED, MSG, WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP, WM_QUIT,
        WM_SYSKEYDOWN, WM_SYSKEYUP,
    };

    use crate::island::WINDOW_LABEL;
    use crate::log;

    const VK_ESCAPE: u32 = 0x1B;
    const VK_RSHIFT: u32 = 0xA1;
    const VK_RCONTROL: u32 = 0xA3;
    const VK_RMENU: u32 = 0xA5;

    #[derive(Clone, Copy, Debug, PartialEq)]
    enum Press {
        Down,
        Up,
        Escape,
        Other,
    }

    static SINK: Mutex<Option<Sender<Press>>> = Mutex::new(None);
    /// 0 right Ctrl, 1 right Alt, 2 right Shift.
    static KEY: AtomicU8 = AtomicU8::new(0);

    fn vk_of(code: u8) -> u32 {
        match code {
            1 => VK_RMENU,
            2 => VK_RSHIFT,
            _ => VK_RCONTROL,
        }
    }

    /// Modifiers never count as "another key": AltGr even sends a fake left Ctrl.
    fn is_modifier(vk: u32) -> bool {
        matches!(vk, 0x10 | 0x11 | 0x12 | 0xA0..=0xA5 | 0x5B | 0x5C | 0x14)
    }

    unsafe extern "system" fn hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code >= 0 {
            let info = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
            // Our own Ctrl+V and other programs' synthetic keys are not the user's.
            if info.flags.0 & LLKHF_INJECTED.0 == 0 {
                let down = matches!(wparam.0 as u32, WM_KEYDOWN | WM_SYSKEYDOWN);
                let up = matches!(wparam.0 as u32, WM_KEYUP | WM_SYSKEYUP);
                let vk = info.vkCode;
                let press = if vk == vk_of(KEY.load(Ordering::Relaxed)) {
                    if down {
                        Some(Press::Down)
                    } else if up {
                        Some(Press::Up)
                    } else {
                        None
                    }
                } else if down && vk == VK_ESCAPE {
                    Some(Press::Escape)
                } else if down && !is_modifier(vk) {
                    Some(Press::Other)
                } else {
                    None
                };
                if let (Some(p), Some(tx)) = (press, SINK.lock().unwrap().as_ref()) {
                    let _ = tx.send(p);
                }
            }
        }
        CallNextHookEx(None, code, wparam, lparam)
    }

    /// The hook's thread; it ends when dropped.
    pub struct Listener {
        thread_id: u32,
        thread: Option<std::thread::JoinHandle<()>>,
    }

    impl Drop for Listener {
        fn drop(&mut self) {
            unsafe {
                let _ = PostThreadMessageW(self.thread_id, WM_QUIT, WPARAM(0), LPARAM(0));
            }
            if let Some(t) = self.thread.take() {
                let _ = t.join();
            }
            *SINK.lock().unwrap() = None;
        }
    }

    static LISTENER: Mutex<Option<Listener>> = Mutex::new(None);

    /// Starts (or restarts, or stops) the keyboard hook to match the settings.
    pub fn apply(app: &AppHandle, enabled: bool, key: &str) {
        // Dropping the old one stops its hook.
        *LISTENER.lock().unwrap() = None;
        if !enabled {
            return;
        }
        KEY.store(match key { "ralt" => 1, "rshift" => 2, _ => 0 }, Ordering::Relaxed);
        let (tx, rx) = channel::<Press>();
        *SINK.lock().unwrap() = Some(tx);

        let (ready_tx, ready_rx) = channel::<Result<u32, String>>();
        let thread = std::thread::Builder::new().name("coucou-dictation-keys".into()).spawn(move || unsafe {
            let module = GetModuleHandleW(None).ok();
            let handle = match SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook), module.map(Into::into), 0) {
                Ok(h) => h,
                Err(err) => {
                    let _ = ready_tx.send(Err(err.to_string()));
                    return;
                }
            };
            let _ = ready_tx.send(Ok(GetCurrentThreadId()));
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            let _ = UnhookWindowsHookEx(handle);
        });
        let Ok(thread) = thread else { return };
        let thread_id = match ready_rx.recv_timeout(Duration::from_secs(3)) {
            Ok(Ok(id)) => id,
            Ok(Err(err)) => {
                log::line(format!("dictation: keyboard hook failed: {err}"));
                return;
            }
            Err(_) => {
                log::line("dictation: the keyboard hook did not start");
                return;
            }
        };
        *LISTENER.lock().unwrap() = Some(Listener { thread_id, thread: Some(thread) });

        // Turns key presses into "down", "up" and "cancel" for the page.
        let app = app.clone();
        std::thread::Builder::new().name("coucou-dictation".into()).spawn(move || {
            let mut held = false;
            let mut since = Instant::now();
            while let Ok(press) = rx.recv() {
                match press {
                    Press::Down if !held => {
                        held = true;
                        since = Instant::now();
                        let _ = app.emit_to(WINDOW_LABEL, "dictation", "down");
                    }
                    Press::Down => {} // key repeat
                    Press::Up if held => {
                        held = false;
                        // A tap is not dictation: under a third of a second is dropped.
                        let state = if since.elapsed() < Duration::from_millis(300) { "cancel" } else { "up" };
                        let _ = app.emit_to(WINDOW_LABEL, "dictation", state);
                    }
                    Press::Escape | Press::Other if held => {
                        held = false;
                        let _ = app.emit_to(WINDOW_LABEL, "dictation", "cancel");
                    }
                    _ => {}
                }
            }
        }).ok();
    }

    // ── Paste ────────────────────────────────────────────────────────────────

    static CLIPBOARD: Mutex<Option<Clipboard>> = Mutex::new(None);

    fn with_clipboard<T>(f: impl FnOnce(&mut Clipboard) -> T) -> Option<T> {
        let mut slot = CLIPBOARD.lock().unwrap();
        if slot.is_none() {
            *slot = Clipboard::new().ok();
        }
        slot.as_mut().map(f)
    }

    fn key_input(vk: u16, up: bool) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(vk),
                    wScan: 0,
                    dwFlags: if up { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    fn send_paste() -> bool {
        const VK_CONTROL: u16 = 0x11;
        const VK_V: u16 = 0x56;
        let inputs = [
            key_input(VK_CONTROL, false),
            key_input(VK_V, false),
            key_input(VK_V, true),
            key_input(VK_CONTROL, true),
        ];
        unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) as usize == inputs.len() }
    }

    /// Waits (up to a second) until the dictation key is up, so the paste is a
    /// plain Ctrl+V and not Ctrl+Alt+V.
    fn wait_key_up() {
        let vk = vk_of(KEY.load(Ordering::Relaxed)) as i32;
        let until = Instant::now() + Duration::from_secs(1);
        while Instant::now() < until {
            if unsafe { GetAsyncKeyState(vk) } as u16 & 0x8000 == 0 {
                return;
            }
            std::thread::sleep(Duration::from_millis(15));
        }
    }

    /// Puts `text` where the cursor is: on the clipboard (out of its history),
    /// Ctrl+V, and the clipboard gets back what it held 700 ms later — unless
    /// something else was copied meanwhile. False when it could only be copied.
    pub fn paste(text: &str) -> Result<bool, String> {
        use arboard::SetExtWindows;
        wait_key_up();
        let previous = with_clipboard(|c| c.get_text().ok()).flatten();
        let set = with_clipboard(|c| c.set().exclude_from_history().exclude_from_cloud().text(text.to_string()))
            .ok_or("no se pudo abrir el portapapeles")?;
        set.map_err(|e| e.to_string())?;
        std::thread::sleep(Duration::from_millis(40));
        if !send_paste() {
            return Ok(false);
        }
        let ours = text.to_string();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(700));
            let Some(previous) = previous else { return };
            with_clipboard(|c| {
                if c.get_text().ok().as_deref() == Some(ours.as_str()) {
                    let _ = c.set_text(previous);
                }
            });
        });
        Ok(true)
    }
}

#[cfg(windows)]
pub use imp::{apply, paste};

/// Only Windows has it for now.
#[cfg(not(windows))]
pub fn apply(_app: &tauri::AppHandle, _enabled: bool, _key: &str) {}

#[cfg(not(windows))]
pub fn paste(_text: &str) -> Result<bool, String> {
    Err("el dictado todavía solo funciona en Windows".into())
}

pub const SUPPORTED: bool = cfg!(windows);
