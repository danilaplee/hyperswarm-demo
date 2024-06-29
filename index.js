"use strict";

const DHT = require("hyperdht");
const Hypercore = require("hypercore");
const Hyperswarm = require('hyperswarm')
const { publicDHTDiscoveryKey, serverDbPath } = require("./src/constants");
const { initClient } = require("./src/client");
const { createBee } = require("./src/db");
const Hyperbee = require("hyperbee");
const RAM = require("random-access-memory");
const { createRpcServer } = require("./src/rpc");
const { getSeed } = require("./src/utils");
const args = process.argv;
const hasMemory = args.includes("--memory")
const main = async () => {
  // hyperbee db
  const keyPair = DHT.keyPair(Buffer.from(publicDHTDiscoveryKey, "hex"))
  const privatecore = new Hypercore(hasMemory ? RAM : serverDbPath+"_private")
  const privatebee = new Hyperbee(privatecore)
  const hcore = new Hypercore(hasMemory ? RAM : serverDbPath+"_public", keyPair.publicKey, {keyPair});
  await hcore.ready()
  const db = await createBee(hcore)

  const dhtSeed = await getSeed("dht-seed", privatebee)

  // start distributed hash table, it is used for rpc service discovery
  const dht = new DHT({
    port: 40001,
    keyPair: DHT.keyPair(dhtSeed),
    bootstrap: [{ host: "127.0.0.1", port: 30001 }], // note boostrap points to dht that is started via cli
  });
  await dht.ready();
  const foundPeers = hcore.findingPeers()
  
  const swarm = new Hyperswarm()
  
  swarm.on('connection', async (socket) => {
    console.info('connection')
    db.auctionDB.replicate(socket)
  })

  const discovery = swarm.join(hcore.discoveryKey)

  await discovery.flushed()

  swarm.flush().then(() => foundPeers())
  await hcore.update()
  const rpcServer = await createRpcServer(db, privatebee)

  await initClient(rpcServer.publicKey.toString("hex"), {...db, hbee:privatebee})
};

main().catch(console.error);
