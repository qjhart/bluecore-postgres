import ParserJsonld from '@rdfjs/parser-jsonld';
import { Readable } from 'stream';
import fs from 'fs';
//import rdf from '@rdfjs/dataset';
import rdf from 'rdf-ext';
import { DataFactory } from 'n3';

// Create an RDF dataset to act as an in-memory RDF sink
const dataset = rdf.dataset();

// Function to read JSON-LD from a file and populate the dataset
async function loadJsonldToDataset(filePath) {
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
            console.log('Parsing finished!');
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
    try {
        await loadJsonldToDataset('data.jsonld'); // Wait for the dataset to be populated

        // Now you can query the dataset
        // For example, let's query for all triples related to the object 'Jane Doe'
      const allQuads = dataset.match(null, null, null);
      allQuads.forEach(quad => {
        console.log(quad.subject.value, quad.predicate.value, quad.object.value);
      });

        // You can now perform any other queries or operations on the dataset
    } catch (error) {
        console.error('Error loading JSON-LD:', error);
    }
}

// Call the main function
main();
