import { Command } from 'commander';
import pg from 'pg';
const { Client } = pg;
import ParserJsonld from '@rdfjs/parser-jsonld';
import { Readable } from 'stream';
import fs from 'fs';
//import rdf from '@rdfjs/dataset';
import rdf from 'rdf-ext';
import { DataFactory } from 'n3';
import JsonLdProcessor from 'jsonld';
const jp = new JsonLdProcessor();
import md5 from 'md5';

// Context and frame info
import context from '../schema/context.json' assert { type: 'json' };
import instance_frame from '../schema/frames/instance.json' assert { type: 'json' };

instance_frame['@context'] = context["@context"];

const schema = {};
schema.context = context;
schema.frame = {};
schema.frame.default = instance_frame;

// Function to read JSON-LD from a file and populate the dataset
async function loadJsonldToDataset(dataset,filePath) {
    return new Promise((resolve, reject) => {
        // Read the JSON-LD file
        const jsonldContent = fs.readFileSync(filePath, 'utf8');

        // Create a readable stream to feed the parser
        const input = new Readable({
            read: () => {
                input.push(jsonldContent);
                input.push(null); // Mark the end of the stream
            }
        });

        // Initialize the JSON-LD parser
        const parserJsonld = new ParserJsonld();

        // Pipe the input stream into the parser
        const output = parserJsonld.import(input);

        // Collect the quads into the in-memory dataset
      output.on('data', quad => {
            dataset.add(quad);
        });

        // Resolve the promise when parsing is finished
        output.on('end', () => {
            resolve(); // Resolve the promise
        });

        // Handle errors
        output.on('error', (error) => {
            reject(error); // Reject the promise on error
        });
    });
}

// https://github.com/rdf-ext/documentation?tab=readme-ov-file
// https://github.com/quadstorejs/quadstore

// Main function to load the JSON-LD and query the dataset
async function main() {
  const options = program.opts();

  const client = new Client({
    connectionString: options.dsn
  });

  try {
    // Connect to the database using the service configuration
    await client.connect();
    console.log('Connected to the database using service:', options.service);

    // Execute the user-provided query or the default one
    const result = await client.query(options.query);
    console.log('Query result:', result.rows);
  } catch (err) {
    console.error('Error connecting to the database:', err);
  }

  // get each file from command line options
  for (let i = 0; i < program.args.length; i++) {
    // Create an RDF dataset to act as an in-memory RDF sink
    const dataset = rdf.dataset();

    const file = program.args[i];
    console.log('Processing file:', file);
    const namedNode = {};
    const partOf = {};
    const blankNode = {};
    // console.log('blankNode:', blankNode);
    try {
      await loadJsonldToDataset(dataset,file); // Wait for the dataset to be populated
      const allQuads = dataset.match(null, null, null);
      dataset.forEach(quad => {
        if (quad.subject.termType === 'NamedNode') {
          if ( namedNode[quad.subject.value] === undefined ) {
            namedNode[quad.subject.value] = rdf.dataset();
            partOf[quad.subject.value] = quad.subject.value;
          }
          namedNode[quad.subject.value].add(quad);
        } else if (quad.subject.termType === 'BlankNode') {
          if ( namedNode[partOf[quad.subject.value]] === undefined ) {
            // This is a blank node that is not part of a named node.
            if ( blankNode[partOf[quad.subject.value]] === undefined ) {
              blankNode[quad.subject.value] = rdf.dataset();
              partOf[quad.subject.value] = quad.subject.value;
            }
            blankNode[partOf[quad.subject.value]].add(quad);
          } else {
            namedNode[partOf[quad.subject.value]].add(quad);
          }
        } else {
          console.error('Unknown:', quad.subject.value);
        }
        // Now add blank nodes to their parent named node.
        if (quad.object.termType === 'BlankNode' &&
            quad.subject.value !== quad.object.value) {
//          if (quad.object.value === "b656iddOtlocdOtgovresourcesworks11199947" ||
//              quad.object.value === "b650iddOtlocdOtgovresourcesworks11199947") {
//            console.log('Found it:', quad);
//            console.log('partOf:', partOf[quad.subject.value]);
//          }
          //console.log(`${quad.object.value} is part of ${partOf[quad.subject.value]}`);
          //console.log(quad);
          partOf[quad.object.value] = partOf[quad.subject.value];
          // for any other part of with this object.value change to subject.value
          for (const [key, value] of Object.entries(partOf)) {
            if (value === quad.object.value) {
              partOf[key] = partOf[quad.subject.value];
            }
          }
        }
//        console.log(quad.subject.value, quad.predicate.value, quad.object.value);
      });
      // You can now perform any other queries or operations on the dataset
    } catch (error) {
      console.error('Error loading JSON-LD:', error);
    }
    // For each named node, print the triples
    for (const key in blankNode) {
      if (namedNode[partOf[key]] === undefined) {
        console.error('Error: Blank node not part of a named node:', key);
      console.log('Blank Node:', key);
      console.log(`partOf: ${partOf[key]}`);
        console.log(Object.keys(namedNode));
//        continue;
        throw new Error('No parent for blank node: ' + key);
      }
//      console.log(`Adding blank node ${key} to ${partOf[key]}`);
      blankNode[key].forEach(quad => {
        namedNode[partOf[key]].add(quad);
      });
    }
    for (const key in namedNode) {
//      console.log('Named node:', key);
      let label = '';
      const needNode = {};
      const types = {};
      const quads = namedNode[key].match(null, null, null);
      quads.forEach(quad => {
        if (quad.subject.termType === 'BlankNode' &&
            ! quad.subject.value.startsWith('_:')) {
          quad.subject.value = `_:${quad.subject.value}`;
        }
        if (quad.object.termType === 'BlankNode' &&
            ! quad.object.value.startsWith('_:')) {
          quad.object.value = `_:${quad.object.value}`;
        } else if (quad.object.termType === 'NamedNode') {
          needNode[quad.object.value] = true;
          if (quad.subject.value === key && quad.predicate.value === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type') {
            types[quad.object.value] = true;
          }
        }
        if (quad.subject.value === key &&
            quad.predicate.value === 'http://www.w3.org/2000/01/rdf-schema#label') {
          // for now, one label per node
          label = quad.object.value;
        }
        // for now don't include types as needNode
        if (quad.predicate.value === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type') {
          delete needNode[quad.object.value];
        }
      });
      const jsonld = await jp.fromRDF(quads);
      const canonized = await jp.canonize(jsonld, {format: 'application/n-quads'});
      const framed = await jp.frame(jsonld,
                                    { ...schema.frame.default,
                                      '@type': Object.keys(types) });
      const chk = md5(canonized);
//      console.log(`${key} ${chk}`);
//      console.log("\t",Object.keys(types));
//      console.log("\t",Object.keys(needNode));
      delete framed['@context'];
//      console.log(JSON.stringify(framed, null, 2));
      // Insert the JSON-LD into the database
      const insertQuery = `INSERT INTO iri (iri, chk, label, jsonld) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`;
      const insertValues = [key, chk, label, JSON.stringify(framed)];
      try {
        await client.query(insertQuery, insertValues);
      } catch (err) {
        console.error('Error inserting JSON-LD:', err);
      }
    }
  }
  // Disconnect from the database
  await client.end();

}

const program = new Command();

program
    .requiredOption('-s, --service <service>', 'PostgreSQL service name','bluecore')
    .requiredOption('-d, --dsn <dsn>', 'Database DSN connection string','postgres://postgres:bluecore@localhost:5432/bluecore')
    .option('-q, --query <query>', 'SQL query to execute', 'SELECT NOW()')
  .parse(process.argv);

  // Call the main function
  main();
