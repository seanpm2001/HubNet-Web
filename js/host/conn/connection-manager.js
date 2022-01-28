import RxQueue                      from "/js/common/rx-queue.js";
import { checkIsTURN, uuidToRTCID } from "/js/common/util.js";

import { version } from "/js/static/version.js";

import BroadSocket    from "./broadsocket.js";
import SessionManager from "./session-manager.js";
import StatusSocket   from "./status-socket.js";

import ChatSocket from "/js/common/chat-socket.js";
import RTCManager from "/js/common/rtc-manager.js";

import DeserializerPoolParty from "/js/serialize/deserializer-pool-party.js";

export default class ConnectionManager {

  #awaitJoinerInit  = undefined; // (UUID, String) => Promise[Object[Any]]
  #broadSocket      = undefined; // BroadSocket
  #chatManager      = undefined; // ChatManager
  #chatSocket       = undefined; // ChatSocket
  #deserializer     = undefined; // DeserializerPoolParty
  #notifyUser       = undefined; // (String) => Unit
  #onDisconnect     = undefined; // (UUID) => Unit
  #passwordMatches  = undefined; // (String) => Boolean
  #registerPingTime = undefined; // (UUID, Number) => Unit
  #relay            = undefined; // (Object[Any]) => Unit
  #retrialsObj      = undefined; // Object[UUID, Number]
  #rtcManager       = undefined; // RTCManager
  #sessionManager   = undefined; // SessionManager
  #statusSocket     = undefined; // StatusSocket

  // ( ChatManager, ChatManager, (UUID, String) => Promise[Object[Any]], (UUID, Number) => Unit
  // , (Object[Any]) => Unit, (UUID) => Unit, (Array[Promise[RTCStatReport]]) => Unit, (String) => Boolean, Number
  // , (String) => Unit) => ConnectionManager
  constructor( sessionChatManager, globalChatManager, awaitJoinerInit, registerPing
             , relay, onDisconnect, onConnStatChange, passwordMatches, maxCapacity
             , notifyUser) {

    this.#awaitJoinerInit  = awaitJoinerInit;
    this.#broadSocket      = new BroadSocket();
    this.#chatManager      = sessionChatManager;
    this.#chatSocket       = new ChatSocket(globalChatManager);
    this.#deserializer     = new DeserializerPoolParty();
    this.#notifyUser       = notifyUser;
    this.#onDisconnect     = onDisconnect;
    this.#passwordMatches  = passwordMatches;
    this.#registerPingTime = registerPing;
    this.#relay            = relay;
    this.#retrialsObj      = {};
    this.#rtcManager       = new RTCManager(true);
    this.#sessionManager   = new SessionManager(maxCapacity, onConnStatChange);
    this.#statusSocket     = new StatusSocket();

    sessionChatManager.onSend(
      (message) => {
        const channels = this.#sessionManager.getOpenChannels();
        this.#rtcManager.send(...channels)("chat", { message });
      }
    );

  }

  // () => Promise[Array[Number]]
  awaitBandwidthReport = () => this.#awaitSenders("request-bandwidth-report");

  // () => Promise[Array[Number]]
  awaitNewSendReport = () => this.#awaitSenders("request-new-send");

  // (String, Object[Any]?) => Unit
  broadcast = (type, message = {}) => {
    const channels = this.#sessionManager.getOpenChannels();
    this.#rtcManager.sendBurst(...channels)(type, message);
  };

  // (UUID, String, String) => Unit
  connect = (hostID) => {

    const regSig = (joinerID, signaling) => {
      this.#sessionManager.register(joinerID, signaling);
      this.#rtcManager  .notifyClientConnect();
      this.#deserializer.notifyClientConnect();
    };

    const getFullness = this.#sessionManager.isAtCapacity;

    this. #broadSocket.connect(hostID, this.#processOffer, regSig, getFullness);
    this.#statusSocket.connect(hostID);

    setInterval(() => {
      const numPeers = this.#sessionManager.getNumActive();
      this.#statusSocket.updateNumPeers(numPeers);
    }, 1000);

    setInterval(() => {
      const channels = this.#sessionManager.getAllChannels();
      channels.forEach((chan) => this.#rtcManager.send(chan)("keep-alive", {}));
    }, 30000);

    setInterval(() => {
      this.#sessionManager.startNewPingWave().forEach(
        ([channel, id, lastPing]) => {
          this.#rtcManager.send(channel)("ping", { id, lastPing });
        }
      );
    }, 2000);

  };

  // () => Number
  getBandwidth = () => {
    return this.#rtcManager.getBandwidth();
  };

  // () => Object[UUID, Number]
  getBufferedAmounts = () => {
    return this.#sessionManager.getBufferedAmounts();
  };

  // () => Number
  getNewSend = () => {
    return this.#rtcManager.getNewSend();
  };

  // (UUID, String, Object[Any]?) => Unit
  narrowcast = (joinerID, type, message = {}) => {
    const channel = this.#sessionManager.getOpenChannelByID(joinerID, true);
    if (channel !== null) {
      this.#rtcManager.sendBurst(channel)(type, message);
    }
  };

  // (Blob) => Unit
  postImageUpdate = (blob) => {
    this.#statusSocket.postImageUpdate(blob);
  };

  // () => Unit
  teardown = () => {
    this.#sessionManager.getAllChannels().forEach(
      (channel) => {
        this.#rtcManager.send(channel)("bye-bye");
        channel.close(1000, "Terminating unneeded sockets...");
      }
    );
  };

  // (Number) => Unit
  updateFullness = (maxCapacity) => {
    this.#sessionManager.updateFullness(maxCapacity);
  };

  // (Object[Any]) => Unit
  #awaitSenders = (msg) => {
    const signalers  = this.#sessionManager.getSignalers();
    const sockets    = [this.#broadSocket, this.#statusSocket, this.#chatSocket];
    const awaitables = sockets.concat(signalers);
    const promises   = awaitables.map((s) => s.await(msg));
    return Promise.all(promises);
  };

  // (UUID) => Unit
  #disown = (joinerID) => {
    const channel = this.#sessionManager.getAnyChannelByID(joinerID);
    this.#onDisconnect(joinerID);
    this.#rtcManager  .notifyChannelDisconnect(channel);
    this.#deserializer.notifyClientDisconnect();
    this.#sessionManager.unregister(joinerID);
  };

  // (UUID, RTCPeerConnection) => (RTCSessionDescription) => Unit
  #processOffer = (joinerID, connection) => (offer) => {

    const rtcID   = uuidToRTCID(joinerID);
    const props   = { negotiated: true, id: rtcID };
    const channel = connection.createDataChannel("hubnet-web", props);

    const onRun      = this.#onChannelMessage(joinerID, channel, connection);
    const msgHandler = { reset: () => {}, run: onRun };
    const rxQueue    = new RxQueue(msgHandler, true);

    const sendGreeting = () => {
      const msg = { protocolVersion: version };
      this.#rtcManager.send(channel)("connection-established", msg);
    };

    channel.onopen    = sendGreeting;
    channel.onmessage = rxQueue.enqueue;
    channel.onclose   = () => { this.#disown(joinerID); };

    this.#sessionManager.setNetworking(joinerID, connection, channel);

    this.#setUpConnection(connection, joinerID, offer);

  };

  // (RTCPeerConnection, UUID, RTCSessionDescription) => Unit
  #setUpConnection = (connection, joinerID, offer) => {

    {
      const knownCandies = new Set();
      connection.onicecandidate =
        ({ candidate }) => {
          if (candidate !== undefined && candidate !== null) {
            const candy    = candidate.toJSON();
            const candyStr = JSON.stringify(candy);
            if (!knownCandies.has(candyStr)) {
              knownCandies.add(candyStr);
              this.#sessionManager.sendICECandidate(joinerID, candy);
            }
          }
        };
    }

    connection.setRemoteDescription(offer).
      then(()     => connection.createAnswer()).
      then(answer => connection.setLocalDescription(answer)).
      then(()     => {
        const desc = connection.localDescription.toJSON();
        this.#sessionManager.sendRTCAnswer(joinerID, desc);
      });

  };

  // (UUID, RTCDataChannel, RTCPeerConnection) => (Object[Any]) => Unit
  #onChannelMessage = (joinerID, channel, connection) => (datum) => {

    switch (datum.type) {

      case "chat": {

        const username = this.#sessionManager.lookupUsername(joinerID) || "???";
        this.#chatManager.addNewChat(datum.message, username);

        const dontSendTo  = this.#sessionManager.getOpenChannelByID(joinerID);
        const allChannels = this.#sessionManager.getOpenChannels();
        const sendTos     = allChannels.filter((c) => c !== dontSendTo);

        const obj = { message: datum.message, username };

        this.#rtcManager.send(...sendTos)("chat-relay", obj);

        break;

      }

      case "connection-established": {

        const { protocolVersion, usesTURN, uuid } = datum;

        if (protocolVersion !== version) {
          const id = this.#sessionManager.invalidate(joinerID);
          this.#notifyUser(`HubNet protocol version mismatch!  You are using protocol version '${version}', while client '${id}' is using version '${protocolVersion}'.  To ensure that you and the client are using the same version of HubNet Web, all parties should clear their browser cache and refresh the page.  The offending client has been disconnected.`);
        }

        if (this.#retrialsObj[uuid] === undefined) {
          this.#retrialsObj[uuid] = 0;
        }

        connection.getStats().then(
          (stats) => {

            const imUsingTURN = checkIsTURN(stats);

            if (this.#retrialsObj[uuid] < 10 && (usesTURN || imUsingTURN)) {

              this.#retrialsObj[uuid]++;
              console.warn(`Joiner '${uuid}' is renegotiating, due to TURN usage #${this.#retrialsObj[uuid]}.`);
              const msg = { isApproved: false };
              this.#rtcManager.send(channel)("connection-validation", msg);

              setTimeout(() => {
                if (channel.readyState === "open") {
                  channel.close(1000, "Terminated due to TURN usage");
                }
              }, 10000);

            } else {
              this.#retrialsObj[uuid] = 0;
              const msg = { isApproved: true };
              this.#rtcManager.send(channel)("connection-validation", msg);
            }

          }
        );

        break;

      }

      case "login": {
        this.#handleLogin(joinerID, channel)(datum);
        break;
      }

      case "pong": {
        const pingTime = this.#sessionManager.pong(joinerID, datum.id);
        this.#registerPingTime(joinerID, pingTime);
        break;
      }

      case "relay": {
        this.#relay(datum.payload);
        break;
      }

      case "bye-bye": {
        this.#disown(joinerID);
        break;
      }

      default: {
        console.warn("Unknown channel event type:", datum.type);
      }

    }

  };

  // (UUID, RTCDataChannel) => (Object[{ username :: String, password :: String }]) => Unit
  #handleLogin = (joinerID, channel) => ({ username, password }) => {

    const reply = (msgType) => { this.#rtcManager.send(channel)(msgType); };

    if (username !== undefined) {

      if (this.#sessionManager.usernameIsUnique(joinerID, username)) {
        if (this.#passwordMatches(password)) {

          this.#sessionManager.logIn(joinerID, username);
          reply("login-successful");

          this.#awaitJoinerInit(joinerID, username).
            then(({ role, state, viewState: view }) => {
              const token = joinerID;
              this.narrowcast(token, "initial-model", { role, token, state, view });
              this.#sessionManager.setInitialized(token);
            });

        } else {
          reply("incorrect-password");
        }
      } else {
        reply("username-already-taken");
      }

    } else {
      reply("no-username-given");
    }

  };

}
