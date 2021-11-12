import SessionData   from "./session-data.js";
import SessionStream from "./session-stream.js";

import usePlaceholderPreview from "./use-placeholder-preview.js";

// type SelNotifier = (SessionData, Element, UUID) => Unit

// (Element, String) => Element?
const descByID = (elem, id) => elem.querySelector(`#${id}`);

// (Element) => String
const extractQuery = (elem) => elem.value.trim().toLowerCase();

// (Element) => UUID
const getID = (elem) => elem.dataset.uuid;

export default class SessionList {

  #stream = undefined; // SessionStream

  // (Element, SessionData, (String) => Unit, SelNotifier) => SessionList
  constructor(parent, onStreamInit, setStatus, notifySel) {

    const filterBox = descByID(parent, "session-filter-box");
    const data      = new SessionData();

    this.#stream = this.#genSessionStream( filterBox, parent, data, setStatus
                                         , notifySel, onStreamInit);

    usePlaceholderPreview();

    this.#initListeners(filterBox, parent, data, setStatus, notifySel);

  }

  // () => Unit
  enable = () => {
    this.#stream.connect();
  };

  // () => Unit
  hibernate = () => {
    this.#stream.hibernate();
  };

  // (Element, SessionData, (String) => Unit, SelNotifier) => (Object[Session]) => Node
  #genSessionNode = (parent, seshData, setStatus, notifySel) =>
                    ({ modelName, name, oracleID, roleInfo: [[ , numClients]] }) => {

    const node = descByID(parent, "session-option-template").content.cloneNode(true);

    node.querySelector(".session-name").textContent       = name;
    node.querySelector(".session-model-name").textContent = modelName;
    node.querySelector(".session-info").textContent       = `${numClients} people`;
    node.querySelector(".session-label").dataset.uuid     = oracleID;

    node.querySelector(".session-option").addEventListener("change", (event) => {

      if (event.target.checked) {

        event.target.parentNode.classList.add("active");
        this.#refreshImage(parent, oracleID);

        this.#refreshSelection(parent, seshData, notifySel);
        setStatus("Session selected.  Please enter a username, enter a password (if needed), and click 'Join'.");

      } else {
        node.querySelector(".session-label").classList.remove("active");
      }

    });

    return node;

  };

  // (Element, Element, SessionData, (String) => Unit, SelNotifier, (SessionData) => Unit) => SessionStream
  #genSessionStream = ( filterBox, parent, seshData, setStatus, notifySel
                      , onStreamInit) => {
    return new SessionStream(
      ({ data }) => {

        const wasInited = seshData.hasBeenInitialized();

        seshData.set(JSON.parse(data));

        this.#refilter( extractQuery(filterBox), parent, seshData
                      , setStatus, notifySel);

        if (!wasInited) {
          onStreamInit(seshData);
        }

      }
    );
  };

  // (Element, Element, SessionData, (String) => Unit, SelNotifier) => Unit
  #initListeners = (filterBox, parent, data, setStatus, notifySel) => {
    filterBox.addEventListener("input", () => {
      this.#refilter(extractQuery(filterBox), parent, data, setStatus, notifySel);
    });
  };

  // (Element, SessionData, (String) => Unit, SelNotifier) => Unit
  #populate = (parent, seshData, setStatus, notifySel) => {

    const lower      = (x)    => x.name.toLowerCase();
    const comparator = (a, b) => (lower(a) < lower(b)) ? -1 : 1;
    const genNode    = this.#genSessionNode(parent, seshData, setStatus, notifySel);
    const nodes      = seshData.get().sort(comparator).map(genNode);

    const container = descByID(parent, "session-option-container");
    const labels    = Array.from(container.querySelectorAll(".session-label"));
    const selected  = labels.find((l) => l.querySelector(".session-option").checked);

    if (selected !== undefined) {

      const matches = (node) =>
        getID(node.querySelector(".session-label")) === getID(selected);

      const match = nodes.find(matches);

      if (match !== undefined) {
        match.querySelector(".session-option").checked = true;
        this.#refreshImage(parent, getID(selected));
      } else {
        usePlaceholderPreview();
      }

    } else {
      if (!seshData.isEmpty()) {
        setStatus("Session list received.  Please select a session.");
      } else if (!seshData.isEmptyUnfiltered()) {
        setStatus("Session list received.  There are some sessions available, but they are hidden by your search filter.");
      } else {
        setStatus("Please wait until someone starts a session, and it will appear in the list below.");
      }
    }

    container.innerHTML = "";
    nodes.forEach((node) => container.appendChild(node));

    this.#refreshSelection(parent, seshData, notifySel);

  };

  // (String, Element, SessionData, (String) => Unit, SelNotifier) => Unit
  #refilter = (term, parent, seshData, setStatus, notifySel) => {

    const matches = (haystack, needle) => haystack.toLowerCase().includes(needle);
    const checkIt = (s) => matches(s.name, term) || matches(s.modelName, term);

    if (term !== "") {
      seshData.applyFilter(checkIt);
    } else {
      seshData.clearFilter();
    }

    this.#populate(parent, seshData, setStatus, notifySel);

  };

  // (Element, UUID) => Unit
  #refreshImage = (parent, oracleID) => {
    const image = descByID(parent, "session-preview-image");
    fetch(`/preview/${oracleID}`).then((response) => {
      if (response.ok) {
        response.text().then((base64) => { image.src = base64; });
      } else {
        usePlaceholderPreview();
      }
    }).catch(() => { usePlaceholderPreview(); });
  };

  // (Element, SessionData, SelNotifier) => Unit
  #refreshSelection = (parent, seshData, notifyNewSelection) => {

    const oldActiveElem = parent.querySelector(".active");
    const oldActiveUUID = (oldActiveElem !== null) ? getID(oldActiveElem) : null;

    const container = descByID(parent, "session-option-container");
    Array.from(container.querySelectorAll(".session-label")).forEach(
      (label) => {
        if (label.querySelector(".session-option").checked) {
          label.classList.add("active");
        } else {
          label.classList.remove("active");
        }
      }
    );

    const activeElem = parent.querySelector(".active");

    notifyNewSelection(seshData, activeElem, oldActiveUUID);

  };

}
