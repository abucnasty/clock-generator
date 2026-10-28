import { afterEach } from 'vitest';

// Testing Library unmounts what a test rendered only where the test runs in a DOM; its own setup of React's act
// environment needs Vitest's globals, which this project does not turn on, so it is set here and React warns of an
// update outside act()
if (typeof document !== 'undefined') {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const { cleanup } = await import('@testing-library/react');
    afterEach(cleanup);
}
