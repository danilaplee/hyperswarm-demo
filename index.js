"use strict";

const RPC = require("@hyperswarm/rpc");
const DHT = require("hyperdht");
const Hypercore = require("hypercore");
const crypto = require("node:crypto");
const Hyperswarm = require('hyperswarm')
const { AuctionCommands, publicDHTDiscoveryKey, serverDbPath } = require("./src/constants");
const { initClient } = require("./src/client");
const { createBee, getBidTopicSubId} = require("./src/db");
const main = async () => {
  // hyperbee db
  const keyPair = DHT.keyPair(Buffer.from(publicDHTDiscoveryKey, "hex"))
  const hcore = new Hypercore(serverDbPath, keyPair.publicKey, {keyPair});
  await hcore.ready()
  const db = await createBee(hcore)
  const {hbee, auctionDB, bidsDBs, currentPriceNames, currentPrices} = db
  // resolved distributed hash table seed for key pair

  let dhtSeed = crypto.randomBytes(32);
  // start distributed hash table, it is used for rpc service discovery
  const dht = new DHT({
    port: 40001,
    keyPair: DHT.keyPair(dhtSeed),
    bootstrap: [{ host: "127.0.0.1", port: 30001 }], // note boostrap points to dht that is started via cli
  });
  await dht.ready();

  // resolve rpc server seed for key pair
  const foundPeers = hcore.findingPeers()

  let rpcSeed = crypto.randomBytes(32);
  
  const swarm = new Hyperswarm({dht})
  
  swarm.on('connection', async (socket) => {
    socket.on('data', data => console.log('client got message:', data.toString("utf-8")))
    const rep = hcore.replicate(socket)
  })
  hcore.on('peer-add', (peer)=>{
    console.info('new server peer')
  })

  const discovery = swarm.join(hcore.discoveryKey)

  await discovery.flushed()


  // swarm.flush() will wait until *all* discoverable peers have been connected to
  // It might take a while, so don't await it
  // Instead, use core.findingPeers() to mark when the discovery process is completed
  swarm.flush().then(() => foundPeers())
  // This won't resolve until either
  //    a) the first peer is found
  // or b) no peers could be found
  await hcore.update()

  const rpc = new RPC({ seed: rpcSeed });
  const rpcServer = rpc.createServer();
  await rpcServer.listen();

  rpcServer.respond(AuctionCommands.createAuction, async (reqRaw) => {
    try {
      const req = JSON.parse(reqRaw.toString("utf-8"));
      console.info("new auction", req);
      const id = crypto.randomUUID();

      if (req.name) await auctionDB.put(id, reqRaw);
      else throw "no_auction_name";

      const resp = { success: true, id };

      // we also need to return buffer response
      const respRaw = Buffer.from(JSON.stringify(resp), "utf-8");
      bidsDBs[id] = hbee.sub(getBidTopicSubId(id));

      return respRaw;
    } catch (err) {
      console.error("write auction error", err);
      const respRaw = Buffer.from(
        JSON.stringify({ error: err?.message || err }),
        "utf-8",
      );
      return respRaw;
    }
  });

  rpcServer.respond(AuctionCommands.createBid, async (reqRaw) => {
    try {
      const req = JSON.parse(reqRaw.toString("utf-8"));
      console.info("new bid", req);
      const id = crypto.randomUUID();

      if (req.amount && req.auctionId) {
        const amount = parseFloat(req.amount);
        const data =  (await auctionDB.get(req.auctionId))?.value?.toString("utf-8")
        console.info("action data", data)
        const auction = JSON.parse(data);
        if (auction.closed) throw "auction_closed";
        if (
          amount < auction.minPrice ||
          amount < currentPrices[req.auctionId] ||
          amount === currentPrices[req.auctionId]
        ) {
          throw "the bid is too low";
        }
        await bidsDBs[req.auctionId].put(id, reqRaw);
        currentPrices[req.auctionId] = req.amount;
        currentPriceNames[req.auctionId] = req.userName;
      } else throw "invalid_params";

      const resp = { success: true };

      // we also need to return buffer response
      const respRaw = Buffer.from(JSON.stringify(resp), "utf-8");

      return respRaw;
    } catch (err) {
      console.error("write bid error", err);
      const respRaw = Buffer.from(
        JSON.stringify({ error: err?.message || err }),
        "utf-8",
      );
      return respRaw;
    }
  });

  rpcServer.respond(AuctionCommands.finalizeAuction, async (reqRaw) => {
    try {
      const req = JSON.parse(reqRaw.toString("utf-8"));
      console.info("close auction", req);
      let auction;

      if (req.auctionId) {
        auction = JSON.parse(
          (await auctionDB.get(req.auctionId))?.value?.toString("utf-8"),
        );

        //TO-DO VALIDATE HERE WITH PUB-PRIV-KEY SIGNATURE
        //AND NOT WITH USERNAME
        if (req.userName !== auction.userName) throw "only_owner_can_finalize";

        if (auction.closed) throw "auction_closed";

        auction.closed = true;
        await auctionDB.put(
          req.auctionId,
          Buffer.from(JSON.stringify(auction), "utf-8"),
        );
      } else throw "invalid_params";

      const resp = {
        success: true,
        winnerName: currentPriceNames[req.auctionId],
        winnerPrice: currentPrices[req.auctionId],
        req,
        auction,
      };

      // we also need to return buffer response
      const respRaw = Buffer.from(JSON.stringify(resp), "utf-8");

      return respRaw;
    } catch (err) {
      console.error("finalize auction error", err);
      const respRaw = Buffer.from(
        JSON.stringify({ error: err?.message || err }),
        "utf-8",
      );
      return respRaw;
    }
  });
  initClient(rpcServer.publicKey.toString("hex"), db)
};

main().catch(console.error);
