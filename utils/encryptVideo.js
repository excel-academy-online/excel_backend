const crypto = require("crypto");
const AppError = require("./errors/AppError");

async function encryptVideo(buffer, key, iv) {
    
  if (key.length !== 32) {
    throw new Error("Your encryption key must be 32 bytes for aes-256-cbc");
  }
  if (iv.length !== 16) {
    throw new Error("Your encryption IV must be 16 bytes for aes-256-cbc");
  }
  const cipher = crypto.createCipheriv("aes-256-cbc", Buffer.from(key, ), iv);
  const encryptedBuffer = Buffer.concat([
    cipher.update(buffer),
    cipher.final(),
  ]);
  return encryptedBuffer;
}
module.exports = encryptVideo;
