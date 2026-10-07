// The QR that links a phone: the sync server's address and the account code,
// as coucou://pair?server=…&code=… (what mobile/src/logic/link.ts parses). Drawn
// as inline SVG, black on white with a quiet border so any camera reads it.

import qrcode from "qrcode-generator";

export function pairingText(server: string, code: string): string {
  return `coucou://pair?server=${encodeURIComponent(server)}&code=${encodeURIComponent(code)}`;
}

export function pairingQr(server: string, code: string, size = 220): SVGSVGElement {
  // Type 0 = the smallest that fits; "M" survives a little glare or a scratch.
  const qr = qrcode(0, "M");
  qr.addData(pairingText(server, code));
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 4;
  const svgNs = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("viewBox", `0 0 ${n + quiet * 2} ${n + quiet * 2}`);
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Código QR para enlazar el teléfono");
  const bg = document.createElementNS(svgNs, "rect");
  bg.setAttribute("width", "100%");
  bg.setAttribute("height", "100%");
  bg.setAttribute("fill", "#fff");
  svg.append(bg);
  let d = "";
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (qr.isDark(y, x)) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    }
  }
  const path = document.createElementNS(svgNs, "path");
  path.setAttribute("d", d);
  path.setAttribute("fill", "#000");
  svg.append(path);
  svg.style.borderRadius = "10px";
  return svg;
}
