'use strict'

const RPC = require('@hyperswarm/rpc')
const DHT = require('hyperdht')
const Hypercore = require('hypercore')
const Hyperbee = require('hyperbee')
const crypto = require('node:crypto')
const {AuctionCommands} = require('./constants')

const getBidTopicSubId = (id) => 'auction_bids_'+id

const main = async () => {
  // hyperbee db
  const hcore = new Hypercore('./db/rpc-server')
  const hbee = new Hyperbee(hcore, { keyEncoding: 'utf-8', valueEncoding: 'binary' })
  await hbee.ready()

  // resolved distributed hash table seed for key pair
  let dhtSeed = (await hbee.get('dht-seed'))?.value
  if (!dhtSeed) {
    // not found, generate and store in db
    dhtSeed = crypto.randomBytes(32)
    await hbee.put('dht-seed', dhtSeed)
  }
  const auctionDB = hbee.sub("auctions")
  const bidsDBs = {}
  const auctionsReadStream = auctionDB.createHistoryStream()
  auctionsReadStream.addListener("data", (data)=>{
    try {
      console.info("old auction", data.key)
      if(data.value) {
        const item = JSON.parse(data.value.toString('utf-8'))
        console.info("old auction", item)
        bidsDBs[data.key] = hbee.sub(getBidTopicSubId(data.key))
      }
    } catch(err) {
      console.error("parse history error", err)
    }
  })

  // start distributed hash table, it is used for rpc service discovery
  const dht = new DHT({
    port: 40001,
    keyPair: DHT.keyPair(dhtSeed),
    bootstrap: [{ host: '127.0.0.1', port: 30001 }] // note boostrap points to dht that is started via cli
  })
  await dht.ready()

  // resolve rpc server seed for key pair
  let rpcSeed = (await hbee.get('rpc-seed'))?.value
  if (!rpcSeed) {
    rpcSeed = crypto.randomBytes(32)
    await hbee.put('rpc-seed', rpcSeed)
  }

  // setup rpc server
  const rpc = new RPC({ seed: rpcSeed, dht })
  const rpcServer = rpc.createServer()
  await rpcServer.listen()
  console.log('rpc server started listening on public key:', rpcServer.publicKey.toString('hex'))
  // rpc server started listening on public key: 763cdd329d29dc35326865c4fa9bd33a45fdc2d8d2564b11978ca0d022a44a19


  const actionWrapper = (actionCB) => {

  }
  rpcServer.respond(AuctionCommands.createAuction, async (reqRaw) => {

    const req = JSON.parse(reqRaw.toString('utf-8'))
    console.info('new auction', req)
    const id = crypto.randomUUID()
    try {
      
      if(req.name)
        await auctionDB.put(id, reqRaw)
      else
        throw "no_auction_name"

      const resp = { success:true, id }
  
      // we also need to return buffer response
      const respRaw = Buffer.from(JSON.stringify(resp), 'utf-8')
      bidsDBs[id] = hbee.sub(getBidTopicSubId(id))
      return respRaw
    } catch(err) {
      console.error("write auction error", err)
      const respRaw = Buffer.from(JSON.stringify({error:err || err.message}), 'utf-8')
      return respRaw
    }
  })

  rpcServer.respond(AuctionCommands.createBid, async (reqRaw) => {

    const req = JSON.parse(reqRaw.toString('utf-8'))
    console.info('new bid', req)
    const id = crypto.randomUUID()
    try {
      
      if(req.amount && req.auctionId) {
        const auction = JSON.parse((await auctionDB.get(req.auctionId))?.value?.toString('utf-8'))
        
        if(auction.closed)
          throw "auction_closed"

        await bidsDBs[req.auctionId].put(id, reqRaw)
      }
      else 
        throw "invalid_params"

      const resp = { success:true }
  
      // we also need to return buffer response
      const respRaw = Buffer.from(JSON.stringify(resp), 'utf-8')

      return respRaw
    } catch(err) {
      console.error("write bid error", err)
      const respRaw = Buffer.from(JSON.stringify({error:err || err.message}), 'utf-8')
      return respRaw
    }
  })

  rpcServer.respond(AuctionCommands.finalizeAuction, async (reqRaw) => {

    const req = JSON.parse(reqRaw.toString('utf-8'))
    console.info('close auction', req)
    try {
      
      if(req.auctionId) {
        const auction = JSON.parse((await auctionDB.get(req.auctionId))?.value?.toString('utf-8'))
        
        if(auction.closed)
          throw "auction_closed"

        auction.closed = true
        await auctionDB.put(req.auctionId, Buffer.from(JSON.stringify(auction), 'utf-8'))

      }
      else 
        throw "invalid_params"

      const resp = { success:true }
  
      // we also need to return buffer response
      const respRaw = Buffer.from(JSON.stringify(resp), 'utf-8')

      return respRaw
    } catch(err) {
      console.error("finalize auction error", err)
      const respRaw = Buffer.from(JSON.stringify({error:err || err.message}), 'utf-8')
      return respRaw
    }
  })
}

main().catch(console.error)