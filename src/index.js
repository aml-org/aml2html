const amf = require('amf-client-js')
const parseArgs = require('minimist')
const ldquery = require('ld-query')
const path = require('path')
const fs = require('fs-extra')
const Mustache = require('mustache')

const TMPL_DIR = path.join(__dirname, '..', 'templates')
const CTX = {
  amldoc: 'http://a.ml/vocabularies/document#',
  meta: 'http://a.ml/vocabularies/meta#',
  owl: 'http://www.w3.org/2002/07/owl#',
  rdf: 'http://www.w3.org/2000/01/rdf-schema#',
  schema: 'http://schema.org/'
}


/* Converts AML Vocabulary to resolved JSON-LD AMF Graph. */
async function getJsonLdGraph (fpathArg) {
  const model = await new amf.Aml10Parser().parseFileAsync(`file://${fpathArg}`)
  const graphStr = await amf.AMF.amfGraphGenerator().generateString(model)
  const graphModel = await amf.AMF.amfGraphParser().parseStringAsync(graphStr)
  const graphResolved = await amf.AMF.resolveAmfGraph(graphModel)
  const graphStrResolved = await amf.AMF.amfGraphGenerator().generateString(graphResolved)
  return JSON.parse(graphStrResolved)
}

/*
  Outputs array of Vocabularies data which looks like:
    [
      ...
      { id: 'file://test_data/vocabularies/data_model.yaml',
        base: 'http://a.ml/vocabularies/data#',
        usage: 'Vocabulary ...',
        classes: [ 'http://a.ml/vocabularies/data#Node', ... ] }
      ...
    ]

  Works on JSON instead of using querying API because the latter picks
  first object in the order of definition instead of picking root
  elements first.
*/
function collectVocabulariesData (doc) {
  const vocabularies = doc.queryAll('amldoc:references')
  vocabularies.push(doc)
  return vocabularies.map((voc) => {
    let vocJson = voc.json()
    return {
      id: vocJson['@id'],
      base: vocJson[`${CTX.meta}base`][0]['@value'],
      usage: vocJson[`${CTX.amldoc}usage`][0]['@value'],
      classes: vocJson[`${CTX.amldoc}declares`]
        .map((decl) => {
          if (decl['@type'].indexOf(`${CTX.owl}Class`) > -1) {
            return decl['@id']
          }
        })
        .filter((id) => { return id !== undefined })
    }
  })
}

/*
  Outputs array of classTerms data which looks like:
    [
      ...
      { id: 'http://a.ml/vocabularies/document#DomainElement',
        name: 'Domain element',
        description: 'asd',
        properties:
         [ { name: 'extends',
             description: 'Target asdasd',
             range: 'http://www.w3.org/2001/XMLSchema#anyUri',
             parent: null } ],
        parents: [] },
      ...
    ]
*/
function collectClassesData (doc) {
  const propsMap = collectPropertiesData(doc)
  const classTerms = doc.queryAll('amldoc:declares[@type=owl:Class]')
    .map((term) => {
      return {
        id: term.query('@id'),
        name: term.query('meta:displayName @value'),
        description: term.query('schema:description @value'),
        properties: term.queryAll('meta:properties @id').map((id) => {
          return propsMap[id]
        }),
        parents: term.queryAll('rdf:subClassOf @id')
      }
    })
  return classTerms
}

/*
  Outputs map of propertyTerms ids to its data which looks like:
    {
       ...
      'http://a.ml/vocabularies/document#displayName': {
        'name': 'display name',
        'description': 'Human readable name for the example',
        'range': 'http://www.w3.org/2001/XMLSchema#string',
        'parent': 'http://schema.org/name'
      },
      ...
    }
*/
function collectPropertiesData (doc) {
  let propsMap = {}
  const propertyTerms = doc.queryAll(
    'amldoc:declares[@type=owl:DatatypeProperty]')
  propertyTerms.forEach((term) => {
    propsMap[term.query('@id')] = {
      name: term.query('meta:displayName @value'),
      description: term.query('schema:description @value'),
      range: term.query('rdf:range @id'),
      parent: term.query('rdf:subPropertyOf @id')
    }
  })
  return propsMap
}

/* Renders single Mustache template with data and writes it to html file */
function renderTemplate (data, tmplName, htmlName, outDir) {
  console.log(`Rendering "${tmplName}" template for "${data.id}"`)
  const inPath = path.join(TMPL_DIR, `${tmplName}.mustache`)
  const tmplStr = fs.readFileSync(inPath, 'utf-8')
  const htmlStr = Mustache.render(tmplStr, data)
  const outPath = path.join(outDir, `${htmlName}.html`)
  fs.writeFileSync(outPath, htmlStr)
}

/* Parses vocabulary name from its @id. */
function parseVocName (vocData) {
  return path.parse(vocData.id).name.toLowerCase()
}

/* Parses class name by splitting it by / and # and picking last part. */
function parseClassName (clsData) {
  const afterSlash = clsData.id.split('/').slice(-1)[0]
  const afterHash = afterSlash.split('#').slice(-1)[0]
  return afterHash.toLowerCase()
}

/* Copies CSS files needed for generated html to look nice. */
function copyCss (outDir) {
  const tmplCssDir = path.join(TMPL_DIR, 'css')
  const outCssDir = path.join(outDir, 'css')
  fs.emptyDirSync(outCssDir)
  fs.copySync(tmplCssDir, outCssDir)
}

/* Runs all the logic. */
async function main () {
  await amf.AMF.init()
  const argv = parseArgs(process.argv.slice(2))

  // Ensure output directory exists
  const outDir = path.resolve(argv.outdir)
  fs.emptyDirSync(outDir)

  const graph = await getJsonLdGraph(argv.vocabulary)

  let doc = ldquery(graph, CTX)
  // Pick root vocabulary itself as a single doc
  doc = doc.query('[@type=meta:Vocabulary]')

  // Vocabularies
  console.log('Collecting vocabularies data')
  const vocsData = collectVocabulariesData(doc)
  vocsData.forEach((voc) => {
    renderTemplate(
      voc, 'vocabulary',
      `voc_${parseVocName(voc)}`, outDir)
  })

  // Classes
  console.log('Collecting classes data')
  const classesData = collectClassesData(doc)
  classesData.forEach((cls) => {
    renderTemplate(
      cls, 'class',
      `cls_${parseClassName(cls)}`, outDir)
  })

  // Copy css
  copyCss(outDir)
}

main()