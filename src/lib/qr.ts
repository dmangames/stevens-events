import QRCode from "qrcode";

/** The QR encodes only the unguessable ticket token; staff scanners look it up on the server. */
export const qrPng = (token: string) => QRCode.toBuffer(token, { type: "png", width: 360, margin: 2 });

export const qrDataUrl = (token: string) => QRCode.toDataURL(token, { width: 360, margin: 2 });
