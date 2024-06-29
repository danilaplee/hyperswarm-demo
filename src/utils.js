const crypto = require("node:crypto");
const getSeed = async (seedName, hbee) => {

  let rpcSeed = (await hbee.get(seedName))?.value;
  if (!rpcSeed) {
    rpcSeed = crypto.randomBytes(32);
    await hbee.put(seedName, rpcSeed);
  }
  return rpcSeed
}
const keysKey = 'privateSignature2'
const writeRsaKeys = async (db, keys) => {
  const keysData = {
    publicKey:keys.publicKey.export({format:"jwk"}),
    privateKey:keys.privateKey.export({format:"jwk"})
  }
  await db.hbee.put(keysKey, Buffer.from(JSON.stringify(keysData), "utf-8"))
}
const genKeys = () => crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
})
const getRsaKeys = async (db) => {

  let keys = await db.hbee.get(keysKey)
  try {
    if(!keys || !keys.value) {
      
      keys = genKeys()
      await writeRsaKeys(db, keys)

    } else {
      const keysString = keys.value.toString("utf-8")
      keys = JSON.parse(keysString)

      if(!keys.privateKey || !keys.publicKey)
        throw "no_keys_found"
      
      const publicKeyJWK = keys.publicKey

      keys = {
        privateKey:crypto.createPrivateKey({key:keys.privateKey, format:"jwk"}), 
        publicKey:crypto.createPublicKey({key:keys.publicKey, format:"jwk"}),
        publicKeyJWK
      }
    }
  } catch(err) {
    console.error('rsa error', err)
    keys = genKeys()
    await writeRsaKeys(db, keys)
  }
  return keys
}
const signData = async (data, privateKey) => {
  const sign = crypto.createSign('SHA256');
  sign.update(data);
  sign.end();
  const signature = sign.sign(privateKey, "hex");
  return signature
}

module.exports = {
  getSeed,
  getRsaKeys,
  signData
}