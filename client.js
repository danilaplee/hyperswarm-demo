'use strict'

const RPC = require('@hyperswarm/rpc')
const DHT = require('hyperdht')
const Hypercore = require('hypercore')
const Hyperbee = require('hyperbee')
const crypto = require('crypto')
const Table = require('cli-table3');
const { AuctionCommands } = require('./constants')

const userNameDbKey = 'userName1'
// public key of rpc server, used instead of address, the address is discovered via dht
const serverPubKey = Buffer.from('1bfbc81ce01bc3ee5e19f8d8014f46b257d0deef59300df37c43391fde003930', 'hex')

const main = async () => {
  // hyperbee db
  const hcore = new Hypercore('./db/rpc-client')
  const hbee = new Hyperbee(hcore, { keyEncoding: 'utf-8', valueEncoding: 'binary' })
  await hbee.ready()

  // resolved distributed hash table seed for key pair
  let dhtSeed = (await hbee.get('dht-seed'))?.value
  if (!dhtSeed) {
    // not found, generate and store in db
    dhtSeed = crypto.randomBytes(32)
    await hbee.put('dht-seed', dhtSeed)
  }

  // start distributed hash table, it is used for rpc service discovery
  const dht = new DHT({
    port: 50001,
    keyPair: DHT.keyPair(dhtSeed),
    bootstrap: [{ host: '127.0.0.1', port: 30001 }] // note boostrap points to dht that is started via cli
  })
  await dht.ready()

  // rpc lib
  const rpc = new RPC({ dht })

  const client = rpc.connect(serverPubKey)
  const rpcServer = rpc.createServer()
  await rpcServer.listen()
  await client.request(AuctionCommands.sub, Buffer.from(rpcServer.publicKey.toString('hex'), "utf-8"))
  rpcServer.respond("event", (data)=>{
    try {
      const e = JSON.parse(data.toString('utf-8'))
      // console.info("event", e)
      const winner = e.winnerName === userName ? "YOU" : e.winnerName 
      if(e.winnerName)
        setTimeout(()=>{
          console.info(`CONGRATS! ${winner} WON AUCTION ${e.auction?.name} with your bid of ${e.winnerPrice}`)
        }, 500)
    } catch(err) {
      // console.error("parse event error", err.message)
    }
    setTimeout(drawAuctionTable, 300)
  })
  return {
    async create(name, minPrice) {
      // payload for request
      const payload = { name, minPrice, userName, eventName:AuctionCommands.createAuction }
      const payloadRaw = Buffer.from(JSON.stringify(payload), 'utf-8')
    
      const respRaw = await client.request(AuctionCommands.createAuction, payloadRaw)
      const resp = JSON.parse(respRaw.toString('utf-8'))
      console.info(resp)
      if(resp?.error) {
        console.error(resp?.error)
      }
      return resp
    },
    async close(auctionId) {
      // payload for request
      const payload = { auctionId, userName, eventName:AuctionCommands.finalizeAuction }
      const payloadRaw = Buffer.from(JSON.stringify(payload), 'utf-8')
    
      const respRaw = await client.request(AuctionCommands.finalizeAuction, payloadRaw)
      const resp = JSON.parse(respRaw.toString('utf-8'))
      if(resp?.error) {
        console.error(resp?.error)
      }
      return resp
    },
    async bid(auctionId, amount) {
      // payload for request
      const payload = { auctionId, amount, userName, eventName:AuctionCommands.createBid }
      const payloadRaw = Buffer.from(JSON.stringify(payload), 'utf-8')
    
      const respRaw = await client.request(AuctionCommands.createBid, payloadRaw)
      const resp = JSON.parse(respRaw.toString('utf-8'))
      if(resp?.error) {
        console.error(resp?.error)
      }
      return resp
    },
    async getAuctionData() {
      const respRaw = await client.request(AuctionCommands.getAuctioData)
      return JSON.parse(respRaw.toString('utf-8'))

    },
    hbee
  }
}
const readline = require('node:readline');
const { stdin: input, stdout: output } = require('node:process');

const rl = readline.createInterface({ input, output });
const apiPromise = main().catch(console.error)

const docs =  `
You are subscribed to the auctions list

Please add a name to submit commands

`

const docs2 = `
Type one of the commands:

create {auctioName} {minPrice} 
bid {auctionId} {value}
close {auctionId} 
`
let userName = ""
const getName = async () => {
  const api = await apiPromise

  rl.question(docs, (answer)=>{
    if(answer !== "" && typeof answer === "string") {
      userName = answer
      api.hbee.put(userNameDbKey, Buffer.from(answer, 'utf-8'))
    }
    else {
      return getName
    }
    return initCmd()
  });
}
const initCmd = () => {
  console.info(`Hello, ${userName}!`)
  console.info(docs2)
  rl.addListener("line", execCommand)
}

const execCommand = async (answer) => {
  // console.info(answer)
  const api = await apiPromise
  const args = answer.split(" ")
  const name = args.shift()
  if(!api[name]) {
    console.info("incorrect command")
  }
  else {
    api[name](...args)
  }
}

const drawAuctionTable = async () => {
  try {
    const api = await apiPromise
    const auctionData = await api.getAuctionData()
    console.info('')
    const auctionMap = auctionData?.map(a=>(a.name ? [a.name, a.id, a.currentPrice || a.minPrice, a.closed] : undefined)).filter(i=>i).sort((a,b)=>a.name-b.name)
    // console.info('auctions', auctionData, auctionMap)
    const table = new Table({
      head: ['Auction Name', 'Auction Id', "Price", "Finished"],
      colWidths: [30, 40, 20],
      
      // rows
    });
    auctionMap.forEach(i=>table.push(i))

    console.log(table.toString());
  } catch(err) {
    console.error('drawTable error', err?.message || err)
  }
}
const initClient = async () => {
  try {
    const api = await apiPromise
    drawAuctionTable()
    userName = (await api.hbee.get(userNameDbKey))?.value?.toString('utf-8')
    if(userName && userName !== "") {
      return initCmd()
    }
    return setTimeout(getName, 300)
  } catch(err) {
    console.error('getName error', err)
    return setTimeout(getName, 300)
  }
  
}
initClient()

