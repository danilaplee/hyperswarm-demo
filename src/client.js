"use strict";

const RPC = require("@hyperswarm/rpc");
const Table = require("cli-table3");
const { AuctionCommands, docs, docs2, publicDHTDiscoveryKey, clientDbPath} = require("./constants");
const readline = require("node:readline");
const { stdin: input, stdout: output } = require("node:process");
const { getRsaKeys, signData } = require("./utils");
const rl = readline.createInterface({ input, output });

const userNameDbKey = "userName1";
// public key of rpc server, used instead of address, the address is discovered via dht
let serverPubKey; 
let api
let userName = "";
const main = async (db) => {

  const rpc = new RPC();
  const {privateKey, publicKeyJWK} = await getRsaKeys(db)
  const client = rpc.connect(serverPubKey);
  return {
    async create(...args) {
      let name = [args[0]];
      let minPrice = args[1];
      let argIndex = 1;
      while (isNaN(parseFloat(minPrice)) && argIndex < args.length) {
        name.push(args[argIndex]);
        minPrice = args[argIndex++];
      }
      name = name.join(" ").replace(minPrice, "");
      if (!name || typeof name !== "string" || name === "") {
        console.error("invalid name");
        return;
      }
      if (isNaN(parseFloat(minPrice))) {
        console.error("invalid minimum price");
        return;
      }
      const payload = {
        name,
        minPrice,
        userName,
        eventName: AuctionCommands.createAuction,
      };
      const payloadRaw = JSON.stringify(payload)
      payload.signature = await signData(payloadRaw, privateKey)
      payload.publicKey = publicKeyJWK
      const payloadRaw2 = Buffer.from(JSON.stringify(payload), "utf-8");

      const respRaw = await client.request(
        AuctionCommands.createAuction,
        payloadRaw2,
      );
      const resp = JSON.parse(respRaw.toString("utf-8"));
      if (resp?.error) {
        console.error(resp?.error);
      }
      return resp;
    },
    async close(auctionId) {
      if (!auctionId || typeof auctionId !== "string" || auctionId === "") {
        console.error("invalid auctionId");
        return;
      }
      const payload = {
        auctionId,
        userName,
        eventName: AuctionCommands.finalizeAuction,
      };
      payload.signature = await signData(JSON.stringify(payload), privateKey)
      const payloadRaw = Buffer.from(JSON.stringify(payload), "utf-8");

      const respRaw = await client.request(
        AuctionCommands.finalizeAuction,
        payloadRaw,
      );
      const resp = JSON.parse(respRaw.toString("utf-8"));
      if (resp?.error) {
        console.error(resp?.error);
      }
      return resp;
    },
    async bid(auctionId, amount) {
      if (!auctionId || typeof auctionId !== "string" || auctionId === "") {
        console.error("invalid auctionId");
        return;
      }
      if (isNaN(parseFloat(amount))) {
        console.error("invalid value");
        return;
      }
      const payload = {
        auctionId,
        amount,
        userName,
        eventName: AuctionCommands.createBid,
      };
      payload.signature = await signData(JSON.stringify(payload), privateKey)
      const payloadRaw = Buffer.from(JSON.stringify(payload), "utf-8");

      const respRaw = await client.request(
        AuctionCommands.createBid,
        payloadRaw,
      );
      const resp = JSON.parse(respRaw.toString("utf-8"));
      if (resp?.error) {
        console.error(resp?.error);
      }
      return resp;
    },
    async getAuctionData() {
      return await db.getAuctioData()
    },
    hbee:db.hbee
  };
};

const initCmd = () => {
  console.info(`Hello, ${userName}!`);
  console.info(docs2);
  rl.addListener("line", execCommand);
};

const execCommand = async (answer) => {
  // console.info(answer)
  const args = answer.split(" ");
  const name = args.shift();
  if (!api[name]) {
    console.error("incorrect command");
  } else {
    api[name](...args);
  }
};

const drawAuctionTable = async (auctionData) => {
  try {
    console.info("\n \n");
    const auctionMap = auctionData
      ?.map((a) =>
        a.name
          ? [a.name, a.id, a.currentPrice || a.minPrice, a.closed ? "Closed" : "Ongoing", a.userName, a.winnerName]
          : undefined,
      )
      .filter((i) => i)
      .sort((a, b) => a.name - b.name);
    // console.info('auctions', auctionData, auctionMap)
    const table = new Table({
      head: ["Auction Name", "Auction Id", "Price", "Status", "Author Name", "Winner"],
      colWidths: [20, 40, 15, 20, 20, 20],

      // rows
    });
    auctionMap.forEach((i) => table.push(i));

    console.log(table.toString());
  } catch (err) {
    console.error("drawTable error", err?.message || err);
  }
};;
const initClient = async (key, db) => {
  
  serverPubKey = Buffer.from(
    key,
    "hex",
  );
  api = await main(db);
  
  const getName = async () => {
  
    rl.question(docs, (answer) => {
      if (answer !== "" && typeof answer === "string") {
        userName = answer;
        api.hbee.put(userNameDbKey, Buffer.from(answer, "utf-8"));
      } else {
        return getName;
      }
      return initCmd();
    });
  };
  try {
    userName = (await api.hbee.get(userNameDbKey))?.value?.toString("utf-8");
    if (userName && userName !== "") {
      return initCmd();
    }
    return setTimeout(getName, 300);
  } catch (err) {
    console.error("getName error", err);
    return setTimeout(getName, 300);
  }
};

module.exports = {
  initClient,
  drawAuctionTable
}