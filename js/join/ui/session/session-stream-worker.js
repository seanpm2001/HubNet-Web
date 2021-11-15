import { hnw                  } from "/js/common/domain.js";
import { getSocket, setSocket } from "/js/common/websocket.js";

// (MessageEvent) => Unit
onmessage = (e) => {
  switch (e.data.type) {
    case "connect": {
      const socket     = new WebSocket(`ws://${hnw}/hnw/session-stream`);
      socket.onmessage = ({ data }) => {
        postMessage(data);
      };
      setSocket(socket);
      break;
    }
    case "hibernate": {
      getSocket().close(1000, "Session list is not currently needed");
      break;
    }
    default: {
      console.warn("Unknown signaling socket message type:", e.data.type, e);
    }
  }
};