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

// This should be in a library, matching context prefixes
const ns= {
  "bf": rdf.namespace("http://id.loc.gov/ontologies/bibframe/"),
  "bflc": rdf.namespace("http://id.loc.gov/ontologies/bflc/"),
  "lc_hub": rdf.namespace("http://id.loc.gov/resources/hubs/"),
  "lc_instance": rdf.namespace("http://id.loc.gov/resources/instances/"),
  "lc_vocabulary": rdf.namespace("http://id.loc.gov/vocabulary/"),
  "lc_work": rdf.namespace("http://id.loc.gov/resources/works/"),
  "org": rdf.namespace("http://id.loc.gov/datatypes/orgs/"),
  "rdf": rdf.namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#"),
  "rdfs": rdf.namespace("http://www.w3.org/2000/01/rdf-schema#"),
  "xsd": rdf.namespace("http://www.w3.org/2001/XMLSchema#")
}

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

async function fileToNamedNodeDataset(file) {
  const dataset = rdf.dataset();
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
          namedNode[quad.subject.value] = { dataset: rdf.dataset() };
          partOf[quad.subject.value] = quad.subject.value;
        }
        namedNode[quad.subject.value].dataset.add(quad);
      } else if (quad.subject.termType === 'BlankNode') {
        if ( namedNode[partOf[quad.subject.value]] === undefined ) {
          // This is a blank node that is not part of a named node.
          if ( blankNode[partOf[quad.subject.value]] === undefined ) {
            blankNode[quad.subject.value] = { dataset: rdf.dataset() }
            partOf[quad.subject.value] = quad.subject.value;
          }
          blankNode[partOf[quad.subject.value]].dataset.add(quad);
        } else {
          namedNode[partOf[quad.subject.value]].dataset.add(quad);
        }
      } else {
        console.error('Unknown:', quad.subject.value);
      }
      // Now add blank nodes to their parent named node.
      if (quad.object.termType === 'BlankNode' &&
          quad.subject.value !== quad.object.value) {
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
      //        continue;
      throw new Error('No parent for blank node: ' + key);
    }
    blankNode[key].dataset.forEach(quad => {
      namedNode[partOf[key]].dataset.add(quad);
    });
  }
  return namedNode;
}

async function addNamedTable(namedNode, client) {
  for (const key in namedNode) {
    const node = namedNode[key];
    let label = '';
    const use = {};
    const types = {};
    const quads = node.dataset.match(null, null, null);
    quads.forEach(quad => {
      if (quad.subject.termType === 'BlankNode' &&
          ! quad.subject.value.startsWith('_:')) {
        quad.subject.value = `_:${quad.subject.value}`;
      }
      if (quad.object.termType === 'BlankNode' &&
          ! quad.object.value.startsWith('_:')) {
        quad.object.value = `_:${quad.object.value}`;
      } else if (quad.object.termType === 'NamedNode') {
        use[quad.object.value] = true;
        if (quad.subject.value === key && quad.predicate.value === ns.rdf.type.value) {
          types[quad.object.value] = true;
        }
      }
      if (quad.subject.value === key &&
          quad.predicate.value === ns.rdfs.label.value) {
        // for now, one label per node
        label = quad.object.value;
      }
      // for now don't include types as use
      if (quad.predicate.value === ns.rdf.type) {
        delete use[quad.object.value];
      }
    });

    // OK, now we can create our input row
    // Need to read this again, since IDK the internals for a jp json object
    const jsonld = await jp.fromRDF(quads);
    // This is to get a well known checksum for the jsonld packet.
    const canonized = await jp.canonize(jsonld, {format: 'application/n-quads'});
    const chk = md5(canonized);
    // Then, we frame it so jsonb queries/indexes can be pretty
    const framed = await jp.frame(jsonld,
                                  { ...schema.frame.default,
                                    '@type': Object.keys(types) });
    delete framed['@context'];
    //      console.log(JSON.stringify(framed, null, 2));
    // Insert the JSON-LD into the database
    const insertQuery = `INSERT INTO named (uri, chk, label, jsonld) VALUES ($1, $2, $3, $4) ON CONFLICT (uri,chk) DO UPDATE SET label=EXCLUDED.label RETURNING named_id`;
    const insertValues = [key, chk, label, JSON.stringify(framed)];
    try {
      const result=await client.query(insertQuery, insertValues);
      node.named_id = result.rows[0].named_id;
      node.chk = chk;
      node.types = types;
      node.use = use;
    } catch (err) {
      console.error('Error inserting JSON-LD:', err);
    }
  }
}

async function addNamedTypeTable(namedNode, client) {
  for (const key in namedNode) {
    const node = namedNode[key];
    const named_id = namedNode[key].named_id;
    for (const type in node.types) {
      const insertQuery = `INSERT INTO named_type (named_id,type) VALUES ($1, $2) ON CONFLICT DO NOTHING`;
      const insertValues = [named_id, type ];
      try {
        await client.query(insertQuery, insertValues);
      } catch (err) {
        console.error(`Error:insert into named_type(${named_id},${type}):`, err);
      }
    }
  }
}

async function addNamedUseTable(namedNode, client) {
  for (const key in namedNode) {
    const node = namedNode[key];
    const named_id = namedNode[key].named_id;
    for (const uri in node.use) {
      let chk = namedNode[uri]?.chk;

      const insertQuery = `INSERT INTO named_use (named_id, uri, chk) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`;
      const insertValues = [named_id, uri, chk ];
      try {
        await client.query(insertQuery, insertValues);
      } catch (err) {
        console.error(`Error:insert into uri_use(${named_id},${uri},${chk}):`, err);
      }
    }
  }
}

// Main function to load the JSON-LD and query the dataset
async function main() {
  const options = program.opts();

  const client = new Client({
    connectionString: options.dsn
  });

  try {
    // Connect to the database using the service configuration
    await client.connect();
    console.log('Connected to the database using service:', options.dsn);
  } catch (err) {
    console.error('Error connecting to the database:', err);
  }

  // get each file from command line options
  for (let i = 0; i < program.args.length; i++) {
    // Create an RDF dataset to act as an in-memory RDF sink
    const file = program.args[i];
    console.log('Processing file:', file);

    const namedNode = await fileToNamedNodeDataset(file)
    await addNamedTable(namedNode, client);
    await addNamedTypeTable(namedNode, client);
    await addNamedUseTable(namedNode, client);

  }
  // Disconnect from the database
  await client.end();

}

const program = new Command();

program
    .requiredOption('-d, --dsn <dsn>', 'Database DSN connection string','postgres://postgres:bluecore@localhost:5432/bluecore')
  .parse(process.argv);

  // Call the main function
  main();
