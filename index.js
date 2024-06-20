"use strict";

const RPC = require("@hyperswarm/rpc");
const DHT = require("hyperdht");
const Hypercore = require("hypercore");
const Hyperbee = require("hyperbee");
const crypto = require("node:crypto");
const { AuctionCommands } = require("./constants");

const getBidTopicSubId = (id) => "auction_bids_" + id;

const main = async () => {
  // hyperbee db
  const hcore = new Hypercore("./db/rpc-server");
  const hbee = new Hyperbee(hcore, {
    keyEncoding: "utf-8",
    valueEncoding: "binary",
  });
  await hbee.ready();

  // resolved distributed hash table seed for key pair
  let dhtSeed = (await hbee.get("dht-seed"))?.value;
  if (!dhtSeed) {
    // not found, generate and store in db
    dhtSeed = crypto.randomBytes(32);
    await hbee.put("dht-seed", dhtSeed);
  }
  const auctionDB = hbee.sub("auctions");
  const subscribers = hbee.sub("subscribers");
  const bidsDBs = {};
  const subKeys = [];
  const auctions = [];
  const indexedAuction = {};
  const currentPrices = {};
  const currentPriceNames = {};
  const auctionsHistoryStream = auctionDB.createHistoryStream();
  const auctionsLiveStream = auctionDB.createReadStream();
  const subscribersHistoryStream = subscribers.createHistoryStream();

  const processHistoryBid = (data) => {
    try {
      if (data.value) {
        const item = JSON.parse(data.value.toString("utf-8"));
        const amount = parseFloat(item.amount);
        if (
          !currentPrices[item.auctionId] ||
          amount > currentPrices[item.auctionId]
        ) {
          currentPrices[item.auctionId] = amount;
          currentPriceNames[item.auctionId] = item.userName;
        }
      }
      // console.info("currentPrices", currentPrices)
    } catch (err) {
      // console.error('prcess bid err', err)
    }
  };

  const processBidBD = (bidBD) => {
    const bidsHistoryStream = bidBD.createHistoryStream();
    bidsHistoryStream.addListener("data", processHistoryBid);
  };

  const processAuctionStream = (data) => {
    try {
      if (data.value) {
        const item = JSON.parse(data.value.toString("utf-8"));
        item.id = data.key;
        if (!item.closed && item.name && !indexedAuction[item.id]) {
          indexedAuction[item.id] = true;
          auctions.push(item);
          bidsDBs[data.key] = hbee.sub(getBidTopicSubId(data.key));
          processBidBD(bidsDBs[data.key]);
        }
        if (item.closed && indexedAuction[item.id]) {
          auctions.find((i) => {
            if (i.id === item.id) i.closed = true;
          });
        }
      }
    } catch (err) {
      // console.error("parse history error", err)
    }
  };
  auctionsHistoryStream.addListener("data", processAuctionStream);
  auctionsLiveStream.addListener("data", processAuctionStream);
  subscribersHistoryStream.addListener("data", (data) => {
    try {
      if (data.value) {
        const item = data.value;
        subKeys.push(item);
      }
    } catch (err) {
      // console.error("parse subs error", err)
    }
  });

  // start distributed hash table, it is used for rpc service discovery
  const dht = new DHT({
    port: 40001,
    keyPair: DHT.keyPair(dhtSeed),
    bootstrap: [{ host: "127.0.0.1", port: 30001 }], // note boostrap points to dht that is started via cli
  });
  await dht.ready();

  // resolve rpc server seed for key pair
  let rpcSeed = (await hbee.get("rpc-seed"))?.value;
  if (!rpcSeed) {
    rpcSeed = crypto.randomBytes(32);
    await hbee.put("rpc-seed", rpcSeed);
  }

  // setup rpc server
  const rpc = new RPC({ seed: rpcSeed, dht });
  const rpcServer = rpc.createServer();
  await rpcServer.listen();
  console.log(
    "rpc server started listening on public key:",
    rpcServer.publicKey.toString("hex"),
  );
  // rpc server started listening on public key: 763cdd329d29dc35326865c4fa9bd33a45fdc2d8d2564b11978ca0d022a44a19

  const updateSubs = (update) => {
    try {
      subKeys.map((subKey) => {
        try {
          const buff = Buffer.from(subKey, "hex");
          rpc.event(buff, "event", update);
        } catch (err) {
          // console.error('update sub err', err)
        }
      });
    } catch (err) {
      // console.error('update subs error', err)
    }
  };

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
      auctions.push({ ...req, id });

      updateSubs(reqRaw);

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
        const auction = JSON.parse(
          (await auctionDB.get(req.auctionId))?.value?.toString("utf-8"),
        );
        if (auction.closed) throw "auction_closed";
        if (
          amount < auction.minPrice ||
          amount < currentPrices[req.auctionId]
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

      updateSubs(reqRaw);
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

      auctions.find((i) => {
        if (i.id === req.auctionId) i.closed = true;
      });
      // we also need to return buffer response
      const respRaw = Buffer.from(JSON.stringify(resp), "utf-8");

      updateSubs(respRaw);
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
  rpcServer.respond(AuctionCommands.sub, async (reqRaw) => {
    try {
      console.info("new sub", reqRaw.toString("utf-8"));
      subKeys.push(reqRaw.toString("utf-8"));
      subscribers.put(crypto.randomUUID(), reqRaw);
    } catch (err) {
      console.error("finalize auction error", err);
      const respRaw = Buffer.from(
        JSON.stringify({ error: err?.message || err }),
        "utf-8",
      );
      return respRaw;
    }
  });
  rpcServer.respond(AuctionCommands.getAuctioData, async () =>
    Buffer.from(
      JSON.stringify(
        auctions.map((i) => ({ ...i, currentPrice: currentPrices[i.id] })),
      ),
      "utf-8",
    ),
  );
};

main().catch(console.error);
