describe("basic", () => {

  it("connects with low latency", () => {

    let idNum = Math.floor(Math.random() * 1e6)

    //cy.visit("https://hubnetweb.org/join")
    cy.visit("http://localhost:8080/join")
    cy.get("[data-cy='session-row']").click()
    cy.get("[data-cy='username']").type(`apples-${idNum}`)
    cy.get("[data-cy='submit']").click()
    cy.get("[data-cy='view-details']").click()

    cy.get("[data-cy='latency']", { timeout: 30000 }).should(
      (span) => {
        let latency = parseInt(span.text(), 10)
        expect(latency).to.be.at.least(0)
        expect(latency).to.be.at.most(200)
      }
    )

    cy.screenshot()

    cy.on('window:alert', (x) => {
       expect(x).to.contains('No error occurred here.  None at all!');
    })

  })

})
