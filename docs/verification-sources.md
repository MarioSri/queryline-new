# Live browser verification source note

## React effect cleanup

The current React documentation demonstrates that a global browser event listener created in `useEffect` should be removed in the effect cleanup function. This informs Queryline’s review of its window-level keyboard and pointer interactions, ensuring listeners do not accumulate across component lifecycles.

Source: [React `useEffect` reference](https://github.com/reactjs/react.dev/blob/main/src/content/reference/react/useEffect.md), retrieved through Context7 on 2026-08-20.

## Client-side interaction state

React’s current documentation notes that interactive event handlers and state live in client-rendered components. Queryline is intentionally a browser-only SQL console: query execution, workspace state, imports, and command-palette interactions are all validated in the client.

Source: [React client-component guidance](https://github.com/reactjs/react.dev/blob/main/src/content/reference/rsc/use-client.md), retrieved through Context7 on 2026-08-20.
