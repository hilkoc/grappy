/**
 * Round-trip check for the saved graph format.
 *
 * Save and load are driven by native dialogs, which no automated check here can click,
 * so this exercises the part that actually decides whether work survives a restart: the
 * serializer and the parser. Run it with `npm run check:persistence`.
 */

import assert from 'node:assert/strict';

import { GRAPH_FILE_VERSION, parseGraph, serializeGraph } from '../src/renderer/src/persistence.ts';
import type { FunctionDef, GrappyNode } from '../src/renderer/src/types.ts';

const CODE = [
  'def say_greeting(first_name: str, age: int):',
  '    return f"Hi {first_name}"',
  '',
].join('\n');

const functions: FunctionDef[] = [
  {
    id: 'fn-2',
    name: 'Counts',
    varName: 'Counts__fn',
    kind: 'import',
    code: '',
    path: 'collections.Counter',
    params: [{ name: 'iterable', annotation: '', has_default: true, positional_only: true }],
    defined: true,
  },
  {
    id: 'fn-1',
    name: 'Greeting',
    varName: 'Greeting__fn',
    kind: 'source',
    code: CODE,
    path: '',
    params: [
      { name: 'first_name', annotation: 'str', has_default: false, positional_only: false },
      { name: 'age', annotation: 'int', has_default: false, positional_only: false },
    ],
    defined: true,
  },
];

const nodes: GrappyNode[] = [
  {
    id: 'node-3',
    type: 'calculation',
    position: { x: 460.4, y: 60.6 },
    data: { name: 'Greeting', varName: 'Greeting', functionId: 'fn-1', running: true },
  },
  {
    id: 'node-1',
    type: 'inputValue',
    position: { x: 40, y: 60 },
    data: {
      name: 'First Name',
      varName: 'First_Name',
      valueKind: 'string',
      value: 'Ada',
      typeName: 'str',
      shortRepr: "'Ada'",
    },
  },
  {
    id: 'node-2',
    type: 'inputValue',
    position: { x: 40, y: 220 },
    data: { name: 'Age', varName: 'Age', valueKind: 'number', value: '30' },
  },
  {
    id: 'node-3-output',
    type: 'outputValue',
    position: { x: 800, y: 60 },
    data: { name: 'Greeting', varName: 'Greeting', sourceNodeId: 'node-3', shortRepr: "'Hi Ada'" },
  },
];

const edges = [
  { id: 'e2', source: 'node-2', target: 'node-3', targetHandle: 'age' },
  { id: 'e1', source: 'node-1', target: 'node-3', targetHandle: 'first_name' },
  { id: 'node-3-output-edge', source: 'node-3', target: 'node-3-output' },
];

const text = serializeGraph(nodes, edges, functions);
const parsed = JSON.parse(text);

assert.equal(parsed.version, GRAPH_FILE_VERSION, 'the file carries its format version');
assert.ok(Array.isArray(parsed.functions[0].code), 'source is stored one line per array entry');
assert.equal(parsed.functions[0].code[0], 'def say_greeting(first_name: str, age: int):');
assert.equal(parsed.functions[1].path, 'collections.Counter', 'an imported name is stored as text');
assert.ok(!('code' in parsed.functions[1]), 'an imported function carries no source');

assert.deepEqual(
  parsed.functions.map((func: { id: string }) => func.id),
  ['fn-1', 'fn-2'],
  'functions are sorted by id',
);
assert.deepEqual(
  parsed.edges.map((edge: { id: string }) => edge.id),
  ['e1', 'e2', 'node-3-output-edge'],
  'edges are sorted by id',
);
assert.deepEqual(parsed.nodes[2].position, { x: 460, y: 61 }, 'positions are whole pixels');
assert.ok(text.endsWith('}\n'), 'the file ends with a newline');

// Nothing the kernel computed is written out; it all comes back when the graph is replayed.
assert.ok(!text.includes('shortRepr'), 'computed reprs are not saved');
assert.ok(!text.includes('running'), 'transient run state is not saved');

const loaded = parseGraph(text);
assert.equal(
  serializeGraph(loaded.nodes, loaded.edges, loaded.functions),
  text,
  'loading and saving again reproduces the file byte for byte',
);

const greeting = loaded.functions.find((func) => func.id === 'fn-1');
assert.equal(greeting?.code, CODE, 'multi-line source survives the round trip exactly');
assert.equal(greeting?.defined, false, 'a loaded function waits for the kernel to accept it');

const calculation = loaded.nodes.find((node) => node.id === 'node-3');
assert.equal(calculation?.type, 'calculation');
assert.equal(
  calculation?.type === 'calculation' ? calculation.data.functionId : null,
  'fn-1',
  'a calculation node keeps pointing at its function',
);

const input = loaded.nodes.find((node) => node.id === 'node-2');
assert.equal(
  input?.type === 'inputValue' ? input.data.value : null,
  '30',
  'input values survive, so they can be replayed into a fresh kernel',
);

assert.throws(() => parseGraph('not json at all'), /not a valid Grappy file/);
assert.throws(() => parseGraph(JSON.stringify({ version: 99 })), /version 99/);
assert.throws(
  () => parseGraph(JSON.stringify({ version: GRAPH_FILE_VERSION, functions: [] })),
  /nodes is missing/,
);

console.log('persistence round trip passed');
