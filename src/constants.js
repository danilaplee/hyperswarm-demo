module.exports = {
  AuctionCommands: {
    createAuction: "createAuction",
    createBid: "createBid",
    finalizeAuction: "finalizeAuction",
    getAuctioData: "getAuctioData",
    sub: "sub",
  },
  docs:`
You are subscribed to the auctions list

Please add a name to submit commands

`,
  docs2:`
Type one of the commands:

create {auctioName} {minPrice} 
bid {auctionId} {value}
close {auctionId} 
`,
  serverDbPath:"./db/rpc-server",
  publicDHTDiscoveryKey:"480f3d2a8e6b1cf5b18db210921edf502ccfc724e091d51aa2fabe1881ed3935"
};