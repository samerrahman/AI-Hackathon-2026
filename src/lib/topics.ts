import type { Topic } from './models';

export const topics: Topic[] = [
  { id: 'gradient-descent', title: 'Gradient descent', subtitle: 'How a model learns, one step at a time', icon: '↘', rubric: { source: 'curated', concepts: [
    { id: 'goal', title: 'The goal', criterion: 'Explains that an objective or loss measures how wrong a prediction is and learning aims to reduce it.' },
    { id: 'gradient', title: 'The slope', criterion: 'Explains the gradient as the direction and rate of steepest increase of the loss.' },
    { id: 'direction', title: 'The direction', criterion: 'Explains moving opposite the gradient to reduce loss.' },
    { id: 'steps', title: 'Step size', criterion: 'Explains learning rate as step size and consequences of too large or too small a rate.' },
    { id: 'iteration', title: 'Repeat & refine', criterion: 'Explains repeated updates of parameters and stopping or convergence.' },
    { id: 'example', title: 'Concrete example', criterion: 'Gives a grounded example such as fitting a line or walking downhill.' },
  ] } },
  { id: 'photosynthesis', title: 'Photosynthesis', subtitle: 'Turning sunlight into stored energy', icon: '☀', rubric: { source: 'curated', concepts: [
    { id: 'inputs', title: 'Ingredients', criterion: 'Names light, water, and carbon dioxide as inputs.' },
    { id: 'chloroplast', title: 'Where it happens', criterion: 'Identifies chloroplasts/chlorophyll as where light is captured.' },
    { id: 'conversion', title: 'Energy conversion', criterion: 'Explains light energy becomes chemical energy.' },
    { id: 'outputs', title: 'Products', criterion: 'Explains glucose/sugar is made and oxygen is released.' },
    { id: 'purpose', title: 'Why it matters', criterion: 'Connects stored sugar to plant growth or food webs.' },
    { id: 'example', title: 'Concrete example', criterion: 'Uses a concrete plant or environmental example.' },
  ] } },
  { id: 'recursion', title: 'Recursion', subtitle: 'A problem that calls on a smaller version of itself', icon: '↻', rubric: { source: 'curated', concepts: [
    { id: 'self', title: 'Self reference', criterion: 'Explains a function or solution calls itself on a smaller subproblem.' },
    { id: 'base', title: 'Base case', criterion: 'Explains a stopping condition that does not recur.' },
    { id: 'progress', title: 'Progress', criterion: 'Explains each call approaches the base case.' },
    { id: 'unwind', title: 'Return path', criterion: 'Explains how results return through earlier calls.' },
    { id: 'risk', title: 'Failure mode', criterion: 'Recognizes missing base case or no progress causes endless recursion/stack overflow.' },
    { id: 'example', title: 'Concrete example', criterion: 'Gives a concrete example such as factorial or nested folders.' },
  ] } },
];

export const topicById = (id: string) => topics.find((topic) => topic.id === id);
