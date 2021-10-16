import { encodePBuf } from "./protobuf/converters-common.js"

import { logEntry  } from "./bandwidth-monitor.js"
import { genUUID, HNWProtocolVersionNumber, typeIsOOB } from "./common.js"
import { genNextID } from "./id-manager.js"
import { HNWRTC    } from "./webrtc.js"
import { HNWWS     } from "./websocket.js"

// A dummy... for now.  I'll bring in the proper library later. --JAB (7/29/19)
const pako = {
  deflate: ((x) => x)
, inflate: ((x) => x)
};

// (Any) => String
const compress = (data) => {
  return pako.deflate(data, { to: '???' });
};

// (String, Number) => Array[String]
const chunk = (arr, length) => {
  const baseArray = Array.from(Array(Math.ceil(arr.length / length)));
  return baseArray.map((x, i) => arr.slice(length * i, length * (i + 1)));
};

// (String) => Any
const decompress = (deflated) => {
  return pako.inflate(deflated, { to: '???' });
};

// (Array[_]) => Array[Array[U]]
const chunkForSending = (message) => {

  const chunkSize  = 2400;
  const compressed = compress(message);
  const messages   = chunk(compressed, chunkSize);

  if (messages.length * chunkSize <= 2e7)
    return messages;
  else
    throw new Error('This activity is generating too much data for HubNet Web to reliably transfer.  Aborting....');

};

let encoderPool = new Worker('js/protobuf/encoder-pool.js');

encoderPool.onmessage = (msg) => {
  switch (msg.type) {
    case "shutdown-complete":
      break;
    default:
      console.warn("Unknown encoder pool response type:", e.type, e)
  }
};

let decoderPool = new Worker('js/protobuf/decoder-pool.js');

decoderPool.onmessage = (msg) => {
  switch (msg.type) {
    case "shutdown-complete":
      break;
    default:
      console.warn("Unknown decoder pool response type:", e.type, e)
  }
};

// (WebWorker, Object[Any]) => Promise[Any]
const awaitWorker = (worker, msg) => {

  const f =
    (resolve, reject) => {

      const channel = new MessageChannel();

      channel.port1.onmessage = ({ data }) => {
        channel.port1.close();
        resolve(data);
      };

      worker.postMessage(msg, [channel.port2]);

    };

  return new Promise(f);

}

// (Object[Any], Boolean) => Promise[Any]
const asyncEncode = (parcel, isHost) => {
  if (isHost) {
    return awaitWorker(encoderPool, { type: "encode", parcel });
  } else {
    return new Promise((res, rej) => res(encodePBuf(false)(parcel)));
  }
};

// (Boolean, Protocol.Channel) => (String, Any, UUID) => Unit
const _send = (isHost, channel) => (type, obj, id = genNextID(`${channel.label}-${channel.id}`)) => {

  const parcel = { ...obj };
  parcel.id    = id;

  if (channel instanceof WebSocket) {
    const finalStr = makeMessage(type, parcel);
    logAndSend(finalStr, channel);
  } else {
    parcel.type = type;
    console.log(parcel);
    asyncEncode(parcel, isHost).then((encoded) => logAndSend(encoded, channel));
  }

};

// (Boolean) => (Protocol.Channel) => (String, Any) => Unit
const send = (isHost) => (channel) => (type, obj) => {
  _send(isHost, channel)(type, obj);
};

// (Boolean, Protocol.Channel) => (String, Any, Boolean) => Unit
const sendOOB = (isHost, channel) => (type, obj) => {
  if (channel instanceof WebSocket) {
    const finalStr = makeMessage(type, obj);
    logAndSend(finalStr, channel);
  } else {
    asyncEncode({ type, ...obj }, isHost).then(
      (encoded) => {
        logAndSend(encoded, channel);
      }
    );
  }
}

// (Boolean, Protocol.Channel*) => (String, Any) => Unit
const sendBurst = (isHost, ...channels) => (type, obj) => {

  const genID = (channel) => genNextID(`${channel.label}-${channel.id}`);

  // Log the IDs right away, before we do anything async, lest message IDs get
  // out of order. --Jason B. (10/16/21)
  const idMap = new Map(channels.map((channel) => [channel, genID(channel)]));

  asyncEncode({ type, ...obj }, isHost).then(
    (encoded) => {

      const chunks = chunkForSending(encoded);

      const objs = chunks.map((m, index) => ({ index, fullLength: chunks.length, parcel: m }));

      channels.forEach((channel) => {
        const id = idMap.get(channel);
        objs.forEach((obj, index) => {
          channels.forEach((channel) => _send(isHost, channel)("hnw-burst", obj, id));
        });
      });

    }
  );

};

// (Protocol.StatusBundle) => (Boolean) => (Protocol.Channel*) => (String, Object[Any]) => Unit
const sendObj = (statusBundle) => (isHost) => (...channels) => (type, obj) => {
  channels.forEach((channel) => {
    switch (channel.readyState) {
      case statusBundle.connecting:
        setTimeout(() => { sendObj(statusBundle)(isHost)(channel)(type, obj); }, 50);
        break;
      case statusBundle.closing:
      case statusBundle.closed:
        console.warn(`Cannot send '${type}' message over connection, because it is already closed`, channel, obj);
        break;
      case statusBundle.open:
        if (typeIsOOB(type)) {
          sendOOB(isHost, channel)(type, obj);
        } else {
          send(isHost)(channel)(type, obj);
        }
        break;
      default:
        console.warn(`Unknown connection ready state: ${channel.readyState}`);
    }
  });
};

// (Boolean) => (Protocol.Channel, Protocol.StatusBundle) => Unit
const sendGreeting = (isHost) => (channel, statusBundle) => {
  switch (channel.readyState) {
    case statusBundle.connecting:
      setTimeout(() => { sendGreeting(isHost)(channel, statusBundle); }, 50);
      break;
    case statusBundle.closing:
    case statusBundle.closed:
      console.warn(`Cannot send 'connect-established' message, because connection is already closed`);
      break;
    case statusBundle.open:
      _send(isHost, channel)("connection-established", { protocolVersion: HNWProtocolVersionNumber });
      break;
    default:
      console.warn(`Unknown connection ready state: ${channel.readyState}`);
  }
};

// (WebSocket*) => (Boolean) => (String, Object[Any]) => Unit
const sendWS = sendObj(HNWWS.status);

// (RTCDataChannel*) => (Boolean) => (String, Object[Any]) => Unit
const sendRTC = sendObj(HNWRTC.status);

// (String, Object[Any]) => Unit
const makeMessage = (type, obj) => {
  return JSON.stringify({ type, ...obj });
}

// (Sendable, Protocol.Channel) => Unit
const logAndSend = (data, channel) => {
  logEntry(data, channel);
  channel.send(data);
};

export { decoderPool, decompress, encoderPool, sendBurst, sendGreeting, sendObj, sendOOB, sendRTC, sendWS }
