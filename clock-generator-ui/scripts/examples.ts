// One build per science pack, simplest first, so a newcomer's first Generate is quick. Each is copied flat as
// public/examples/<id>.json and listed in public/examples/index.json, which the examples dialog reads. The Vite plugin
// that copies them and the test that holds each to a picture read this one list.
export const EXAMPLES = [
    { id: 'logistic-science', path: 'science/logistic/logistic-240.json' },
    { id: 'automation-science', path: 'science/automation/automation-240.json' },
    { id: 'utility-science', path: 'science/utility/utility-120.json' },
    { id: 'chemical-science', path: 'science/chemical/chemical-240-shared-foundry.json' },
    { id: 'electromagnetic-science', path: 'science/electromagnetic/electromagnetic-330.json' },
    { id: 'military-science', path: 'science/military/military-240.json' },
    { id: 'production-science', path: 'science/production/production-120-two-belts.json' },
    { id: 'metallurgic-science', path: 'science/metallurgic/metallurgic-45.json' },
    { id: 'agriculture-science', path: 'science/agricultural/agricultural-250.json' },
];
