// Mail (Thunderbird) — types shared between the inbox view and the code
// card. All reading happens in Rust (src-tauri/src/mail/); this file only
// shapes what comes back over the bridge.

export interface MailAccountInfo {
  id: string;
  label: string;
  folders: string[];
  /** Connected straight to the provider over IMAP: can be removed here. */
  direct?: boolean;
}

export interface MailMessageInfo {
  account: string;
  folder: string;
  offset: number;
  len: number;
  subject: string;
  from: string;
  dateRfc3339: string;
}
