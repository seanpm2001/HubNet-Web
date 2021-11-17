import { MinID, nextID } from "./id.js";

export default class IDManager {

  #lastIDMap = undefined; // Object[String, Number]

  constructor() {
    this.#lastIDMap = {};
  }

  // (String) => Number
  next = (ident) => {
    const lid  = this.#lastIDMap[ident];
    const next = (lid !== undefined) ? nextID(lid) : MinID;
    this.#lastIDMap[ident] = next;
    return next;
  };

}
