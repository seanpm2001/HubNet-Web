// (Number, Number) => String
const byteSizeLabel = (n, precision = 2) => {
  const trunc = (x) => parseFloat(x.toFixed(precision));
  return (n >= 1e8) ? `${trunc(n / 1e9)} GB` :
         (n >= 1e5) ? `${trunc(n / 1e6)} MB` :
         (n >= 1e2) ? `${trunc(n / 1e3)} KB` :
                      `${trunc(n)} B`;
};

// (RTCStatReport) => Boolean
const checkIsTURN = (stats) => {
  return Array.from(stats.values()).some(
    (v) =>
      v.type === "candidate-pair" &&
        v.state === "succeeded" &&
        v.localCandidateId &&
        stats.get(v.localCandidateId).candidateType === "relay"
  );
};

// (String) => Number
/* eslint-disable no-bitwise */
const uuidToRTCID = (uuid) => {

  // The docs say that the limit on the number of channels is 65534,
  // but Chromium barfs if the ID is 1024 or higher --Jason B. (7/15/19)
  // Oh, you think Chromium's bad?  Firefox only allows 256! --Jason B. (5/13/21)
  const limit       = 256;
  const toCodePoint = (x)      => x.codePointAt(0);
  const toHash      = (acc, x) => (((acc << 5) - acc) + x) | 0;
  const hash        = Array.from(uuid).map(toCodePoint).reduce(toHash, 0);

  return Math.abs(hash) % limit;

};
/* eslint-enable no-bitwise */

// (String) => Boolean
const typeIsOOB = (type) => {
  return ["bye-bye", "keep-alive", "ping", "pong"].includes(type);
};

export { byteSizeLabel, checkIsTURN, typeIsOOB, uuidToRTCID };
