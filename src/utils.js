const crypto = require("node:crypto");
const getSeed = async (seedName, hbee) => {

  let rpcSeed = (await hbee.get(seedName))?.value;
  if (!rpcSeed) {
    rpcSeed = crypto.randomBytes(32);
    await hbee.put(seedName, rpcSeed);
  }
  return rpcSeed
}

module.exports = {
  getSeed
}