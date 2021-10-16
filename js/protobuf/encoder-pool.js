let clientCount = 0;

let maxNumWorkers = Math.max(1, navigator.hardwareConcurrency - 2);

// Array[{ isIdle: Boolean, worker: WebWorker }]
let workerPool = [];

initWorker = () => {
  let worker = new Worker('encoder.js', { type: "module" });
  workerPool.push({ worker, isIdle: true });
};

encode = (msg, port) => {
  let workerBundle = workerPool.find((bundle) => bundle.isIdle);
  if (workerBundle !== undefined) {
    workerBundle.isIdle = false;

    new Promise(
      (resolve, reject) => {

        const channel = new MessageChannel();

        channel.port1.onmessage = ({ data }) => {
          channel.port1.close();
          resolve(data);
        };

        workerBundle.worker.postMessage({ type: "encode", parcel: msg }, [channel.port2]);

      }
    ).then((encoded) => {
      workerBundle.isIdle = true;
      port.postMessage(encoded);
    });

  } else {
    console.log("All workers are currently busy.  Retrying momentarily....", msg);
    setTimeout((() => encode(msg, port)), 50);
  }
};

onmessage = (e) => {
  switch (e.data.type) {
    case "client-connect":
      clientCount++;
      if ((workerPool.length < maxNumWorkers) && (clientCount % 2 === 1)) {
        initWorker();
      }
      break;
    case "client-disconnect":
      clientCount--;
      break;
    case "encode":
      encode(e.data.parcel, e.ports[0]);
      break;
    case "shutdown":
      workerPool.forEach((w) => w.worker.terminate());
      postMessage({ type: "shutdown-complete" });
      break;
    default:
      console.warn("Unknown encoder pool message type:", e.data.type, e)
  }
};
