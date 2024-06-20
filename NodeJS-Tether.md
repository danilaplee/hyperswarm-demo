# The Tether challenge

Hi and congratulations to your progress with Tether!

Your task is to create a simplified P2P auction solution based on Hyperswarm RPC and Hypercores.

With the RPC Client, you should be able to open auctions (e.g. selling a picture for 50 USDt). Upon opening the auction 
your client should notify other parties in ecosystem about the opened auction, that means that every client should 
have also a small RPC Server. Other parties can make a bid on auction by submitting the offer, in this case each bid
should be propagated to all parties in ecosystem. Upon completion of auction the distributed transaction should be 
propagated to all nodes as well.

Sample scenario:
- Client#1 opens auction: sell Pic#1 for 75 USDt
- Client#2 opens auction: sell Pic#2 for 60 USDt
- Client#2 makes bid for Client#1->Pic#1 with 75 USDt
- Client#3 makes bid for Client#1->Pic#1 with 75.5 USDt
- Client#2 makes bid for Client#1->Pic#1 with 80 USDt
- Client#1 closes auction: notifies Client#2, ...Client#..n with information about selling details: Client#2->80 USDt

Requirements:
- Code should be only in Javascript
- Use Hyperswarm RPC for communication between nodes
- Solution should be P2P and not classic client/server architecture
- There's no need for a UI
- If you need to use a database use only Hypercore or Hyperbee

You should not spend more time than 6-8 hours on the task. We know that its probably not possible to complete the task 100% in the given time.

If you don't get to the end, just write up what is missing for a complete implementation of the task. Also, if your implementation has limitation and issues, that's no big deal. Just write everything down and indicate how you could solve them, given there was more time.

Good luck!

## Tips

Useful resources:
- https://www.npmjs.com/package/@hyperswarm/rpc
- https://docs.holepunch.to/building-blocks/hyperbee
- https://docs.holepunch.to/building-blocks/hypercore
- https://docs.holepunch.to/building-blocks/hyperdht
- https://www.npmjs.com/package/hp-rpc-cli

### Example: simple RPC Server and Client

As first step you need to setup a private DHT network, to do this first install dht node package globally:
```
npm install -g hyperdht
```
Then run your first and boostrap node:
```
hyperdht --bootstrap --host 127.0.0.1 --port 30001
```

With this you have a new distrited hash table network that has boostrap node on 127.0.0.1:30001

Server code:
```js
'use strict'

const RPC = require('@hyperswarm/rpc')
const DHT = require('hyperdht')
const Hypercore = require('hypercore')
const Hyperbee = require('hyperbee')
const crypto = require('crypto')

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

  // bind handlers to rpc server
  rpcServer.respond('ping', async (reqRaw) => {
    // reqRaw is Buffer, we need to parse it
    const req = JSON.parse(reqRaw.toString('utf-8'))

    const resp = { nonce: req.nonce + 1 }

    // we also need to return buffer response
    const respRaw = Buffer.from(JSON.stringify(resp), 'utf-8')
    return respRaw
  })
}

main().catch(console.error)
```

Client code:
```js
'use strict'

const RPC = require('@hyperswarm/rpc')
const DHT = require('hyperdht')
const Hypercore = require('hypercore')
const Hyperbee = require('hyperbee')
const crypto = require('crypto')

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

  // public key of rpc server, used instead of address, the address is discovered via dht
  const serverPubKey = Buffer.from('763cdd329d29dc35326865c4fa9bd33a45fdc2d8d2564b11978ca0d022a44a19', 'hex')

  // rpc lib
  const rpc = new RPC({ dht })

  // payload for request
  const payload = { nonce: 126 }
  const payloadRaw = Buffer.from(JSON.stringify(payload), 'utf-8')

  // sending request and handling response
  // see console output on server code for public key as this changes on different instances
  const respRaw = await rpc.request(serverPubKey, 'ping', payloadRaw)
  const resp = JSON.parse(respRaw.toString('utf-8'))
  console.log(resp) // { nonce: 127 }

  // closing connection
  await rpc.destroy()
  await dht.destroy()
}

main().catch(console.error)
```
