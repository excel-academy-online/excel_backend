import { createHash } from "crypto";


const hashPassword = (password) => {
  const hash = createHash("sha3-256");
  hash.update(password);
  return hash.digest("hex");
};

export default hashPassword;
