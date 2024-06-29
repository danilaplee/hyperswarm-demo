
const Hyperbee = require("hyperbee");
const {drawAuctionTable} = require('./client')
const getBidTopicSubId = (id) => "auction_bids_" + id;
const createBee = async (hcore) => {
  const hbee = new Hyperbee(hcore, {
    keyEncoding: "utf-8",
    valueEncoding: "binary",
  });
  // await hbee.ready();
  const auctionDB = hbee.sub("auctions");
  const bidsDBs = {};
  const auctions = [];
  const indexedAuction = {};
  const currentPrices = {};
  const currentPriceNames = {};
  const bidHistoryStream = hbee.createReadStream();
  const historyStream = auctionDB.createReadStream();
  const liveStream = hbee.createHistoryStream({live:true});
  const auctionLiveStream = auctionDB.createHistoryStream({live:true})

  const getAuctioData = ()=>auctions.map((i) => ({ ...i, currentPrice: currentPrices[i.id] }))

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
      drawAuctionTable(getAuctioData())
      // console.info("currentPrices", currentPrices)
    } catch (err) {
      // console.error('prcess bid err', err)
    }
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
          // processBidBD(bidsDBs[data.key]);
        }
        if (item.closed && indexedAuction[item.id]) {
          auctions.find((i) => {
            if (i.id === item.id) i.closed = true;
          });
        }
        drawAuctionTable(getAuctioData())
      }
    } catch (err) {
      // console.error("parse auction error", err)
      // console.info(data, data?.value?.toString("utf-8"))
    }
  };
  bidHistoryStream.addListener("data", data=>processHistoryBid(data))
  liveStream.addListener("data", (data)=>{
    processHistoryBid(data)
  });
  auctionLiveStream.addListener("data", (data)=>{
    processAuctionStream(data)
  })
  historyStream.addListener("data", (data)=>{
    processAuctionStream(data)
  });
  return {hbee, auctions, bidsDBs, auctionDB, currentPriceNames, currentPrices, getAuctioData }
}

module.exports = {
  createBee,
  getBidTopicSubId
}