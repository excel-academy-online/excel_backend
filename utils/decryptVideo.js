const crypto = require("crypto");

async function decryptVideo(buffer, key, iv) {
  if (key.length !== 32) {
    throw new Error("Your encryption key must be 32 bytes for aes-256-cbc");
  }
  if (iv.length !== 16) {
    throw new Error("Your encryption IV must be 16 bytes for aes-256-cbc");
  }
  const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(key), iv);
decipher.setAutoPadding(true); // Enable automatic padding
const decryptedBuffer = Buffer.concat([
  decipher.update(buffer),
  decipher.final(),
]);

  // const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(key), iv);
  // decipher.setAutoPadding(true);
  // const decryptedBuffer = Buffer.concat([
  //   decipher.update(buffer),
  //   decipher.final(),
  // ]);
  return decryptedBuffer;
}
module.exports = decryptVideo;
