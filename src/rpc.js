
const RPC = require("@hyperswarm/rpc");
const crypto = require("node:crypto");
const { getSeed } = require("./utils");
const { AuctionCommands } = require("./constants");
const { getBidTopicSubId } = require("./db");
const createRpcServer = async (db, privatebee) => {
  const {hbee, auctionDB, bidsDBs, currentPriceNames, currentPrices} = db

  const rpcSeed = await getSeed("peer-seed", privatebee) 
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

      const winnerName = currentPriceNames[req.auctionId]
      if (req.auctionId) {
        auction = JSON.parse(
          (await auctionDB.get(req.auctionId))?.value?.toString("utf-8"),
        );
        //TO-DO VALIDATE HERE WITH PUB-PRIV-KEY SIGNATURE
        //AND NOT WITH USERNAME
        if (req.userName !== auction.userName) throw "only_owner_can_finalize";

        if (auction.closed) throw "auction_closed";
        auction.winnerName = winnerName
        auction.closed = true;
        await auctionDB.put(
          req.auctionId,
          Buffer.from(JSON.stringify(auction), "utf-8"),
        );
      } else throw "invalid_params";

      const resp = {
        success: true,
        winnerName,
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
  return rpcServer
}
module.exports = {
  createRpcServer
}