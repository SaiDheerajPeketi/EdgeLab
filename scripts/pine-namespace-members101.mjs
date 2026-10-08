import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import {build} from "esbuild";
import {readPineEngineSources} from "./pine-engine.mjs";

const require=createRequire(import.meta.url);
const ts=createRequire(new URL("../frontend/package.json",import.meta.url))("typescript");
const repository=fileURLToPath(new URL("../",import.meta.url));
const defaultVendor=path.join(repository,"frontend/vendor/pinets");
const digest=value=>createHash("sha256").update(value).digest("hex");
const excluded=new Set(["constructor","context","fullContext","param","any","prototype","arguments","caller","valueOf","toString"]);
const identifier=/^[A-Za-z][A-Za-z0-9_]*$/;
const relevant=name=>name==="src/Context.class.ts"||name.startsWith("src/namespaces/")||name==="src/marketData/IProvider.ts";

function inputs(vendorRoot=defaultVendor){
 const manifest=JSON.parse(fs.readFileSync(path.join(vendorRoot,"manifest.json"),"utf8"));
 const packageRoot=path.dirname(path.dirname(require.resolve("pinets")));
 return {manifest,sources:readPineEngineSources({packageRoot,vendorRoot,namespaceMembers:false})};
}
function provenance(sources,manifest){
 const hashes=[...sources].filter(([name])=>relevant(name)).sort(([a],[b])=>a.localeCompare(b)).map(([name,text])=>[name,digest(text)]);
 return {schemaVersion:1,version:manifest.version,sourceMapSha256:manifest.sourceMapSha256,
  namespaceSourcesSha256:digest(JSON.stringify(hashes)),
  overrides:manifest.overrides.filter(item=>relevant(item.source)).map(item=>({source:item.source,sha256:item.sha256})).sort((a,b)=>a.source.localeCompare(b.source))};
}
function sourceMetadata(sources){
 const classes=new Map(),symbolFields=[],nested=new Map();
 for(const [name,text] of sources){
  if(!relevant(name))continue;
  const ast=ts.createSourceFile(name,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const unwrap=node=>node&&(ts.isAsExpression(node)||ts.isParenthesizedExpression(node))?unwrap(node.expression):node;
  const objects=new Map(),namespaceObjects=new Set();
  const objectKeys=node=>{
   node=unwrap(node);
   return node&&ts.isObjectLiteralExpression(node)?node.properties.flatMap(property=>property.name&&(ts.isIdentifier(property.name)||ts.isStringLiteral(property.name))?[property.name.text]:[]):[];
  };
  const isNamespaceObject=node=>{
   node=unwrap(node);
   return node&&ts.isObjectLiteralExpression(node)&&(objectKeys(node).includes("valueOf")||node.properties.length>0&&node.properties.every(property=>ts.isMethodDeclaration(property)||ts.isPropertyAssignment(property)&&(ts.isArrowFunction(property.initializer)||ts.isFunctionExpression(property.initializer)||ts.isCallExpression(property.initializer))));
  };
  const collectObjects=node=>{if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&objectKeys(node.initializer).length){objects.set(node.name.text,objectKeys(node.initializer));if(isNamespaceObject(node.initializer))namespaceObjects.add(node.name.text);}ts.forEachChild(node,collectObjects);};
  collectObjects(ast);
  // Strategy's nested namespaces are returned by factories rather than own
  // descriptors. Read their explicit object/assignment keys without calling
  // trading helpers or executing getters.
  if(name.startsWith("src/namespaces/strategy/")){
   const method=/\/methods\/([A-Za-z0-9_]+)\.ts$/.exec(name)?.[1];
   if(method){
    const returned=new Set(),keys=new Set();
    const findReturns=node=>{if(ts.isReturnStatement(node)&&node.expression){const expression=unwrap(node.expression);if(ts.isIdentifier(expression)&&namespaceObjects.has(expression.text))returned.add(expression.text);if(isNamespaceObject(expression))for(const key of objectKeys(expression))keys.add(key);}ts.forEachChild(node,findReturns);};
    findReturns(ast);
    const findAssignments=node=>{if(ts.isPropertyAccessExpression(node)&&ts.isIdentifier(node.expression)&&returned.has(node.expression.text)&&node.parent&&ts.isBinaryExpression(node.parent)&&node.parent.left===node&&node.parent.operatorToken.kind===ts.SyntaxKind.EqualsToken)keys.add(node.name.text);ts.forEachChild(node,findAssignments);};
    findAssignments(ast);
    for(const returnedName of returned)for(const key of objects.get(returnedName)??[])keys.add(key);
    if(keys.size)nested.set("strategy."+method,keys);
   }
   const constants=node=>{
    if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.EqualsToken&&ts.isPropertyAccessExpression(node.left)&&node.left.expression.kind===ts.SyntaxKind.ThisKeyword&&ts.isArrowFunction(node.right)){
     const expression=unwrap(node.right.body);
     if(expression&&ts.isIdentifier(expression)&&objects.has(expression.text))nested.set("strategy."+node.left.name.text,new Set(objects.get(expression.text)));
    }
    ts.forEachChild(node,constants);
   };
   constants(ast);
  }
  const visit=node=>{
   if(ts.isClassDeclaration(node)&&node.name){
    const denied=new Set();
    for(const member of node.members){
     if(member.name&&(ts.isIdentifier(member.name)||ts.isStringLiteral(member.name))&&member.modifiers?.some(m=>[ts.SyntaxKind.PrivateKeyword,ts.SyntaxKind.ProtectedKeyword,ts.SyntaxKind.StaticKeyword].includes(m.kind)))denied.add(member.name.text);
     if(ts.isConstructorDeclaration(member))for(const parameter of member.parameters)if(ts.isIdentifier(parameter.name)&&parameter.modifiers?.some(m=>[ts.SyntaxKind.PrivateKeyword,ts.SyntaxKind.ProtectedKeyword].includes(m.kind)))denied.add(parameter.name.text);
    }
    classes.set(node.name.text,denied);
   }
   if(name==="src/marketData/IProvider.ts"&&ts.isTypeAliasDeclaration(node)&&node.name.text==="ISymbolInfo"&&ts.isTypeLiteralNode(node.type)){
    for(const member of node.type.members)if(member.name&&ts.isIdentifier(member.name))symbolFields.push(member.name.text);
   }
   ts.forEachChild(node,visit);
  };
  visit(ast);
 }
 if(!symbolFields.includes("ticker")||!symbolFields.includes("prefix"))throw new Error("Pinned symbol metadata is missing ticker/prefix.");
 return {classes,symbolFields,nested};
}

// This generator resolves already-verified readable sources directly. It does
// not depend on the generated inventory, so regeneration has no bootstrap cycle.
async function contextModule(verifiedSources){
 const sources=new Map(verifiedSources);
 // Construction only: no Pine compilation is permitted during inventory
 // bootstrap, whose new table does not exist yet.
 sources.set("src/transpiler/pineToJS/inputs/edgelabNamespaceMembers.ts",'export function pineNamespaceHasMember(): never { throw new Error("Pine compilation is unavailable during namespace inventory construction."); }');
 const namespace="pine-namespace-inventory";
 const entry="src/edgelab-namespace-inventory.ts";
 const contents='export {Context} from "./Context.class"; export {createSyminfo} from "./namespaces/Syminfo";';
 const dependencies={acorn:"node_modules/acorn/dist/acorn.mjs","acorn-walk":"node_modules/acorn-walk/dist/walk.mjs",astring:"node_modules/astring/dist/astring.mjs"};
 const output=await build({bundle:true,minify:false,format:"esm",platform:"browser",write:false,logLevel:"silent",
  tsconfigRaw:{compilerOptions:{experimentalDecorators:true,useDefineForClassFields:false}},
  stdin:{contents:'export * from "pine-inventory-entry";',resolveDir:repository},plugins:[{name:"verified-pine-namespace-inventory",setup(builder){
   builder.onResolve({filter:/^pine-inventory-entry$/},()=>({path:entry,namespace}));
   builder.onResolve({filter:/.*/,namespace},args=>{
    const name=Object.hasOwn(dependencies,args.path)?dependencies[args.path]:args.path.startsWith("@pinets/")?"src/"+args.path.slice(8):args.path.startsWith(".")?path.posix.normalize(path.posix.join(path.posix.dirname(args.importer),args.path)):undefined;
    const target=[name,name+".ts",name+"/index.ts",name+".mjs"].find(candidate=>sources.has(candidate));
    if(!target)throw new Error("Missing verified namespace dependency: "+args.path);
    return {path:target,namespace};
   });
   builder.onLoad({filter:/.*/,namespace},args=>({contents:args.path===entry?contents:sources.get(args.path),loader:args.path.endsWith(".mjs")?"js":"ts"}));
  }}]});
 return import("data:text/javascript;base64,"+Buffer.from(output.outputFiles[0].text).toString("base64"));
}
export async function generatePineNamespaceMembers({vendorRoot=defaultVendor}={}){
 const {sources,manifest}=inputs(vendorRoot),{classes,symbolFields,nested}=sourceMetadata(sources);
 const {Context,createSyminfo}=await contextModule(sources);
 const context=new Context({marketData:[],source:[]});
 context.pine.syminfo=createSyminfo(Object.fromEntries(symbolFields.map(name=>[name,null])));
 const table=new Map();
 const inspect=(name,value,ancestors=new Set())=>{
  if(value===null||!["object","function"].includes(typeof value)||ancestors.has(value))return;
  const denied=classes.get(value.constructor?.name),members=new Set(),descriptors=new Map();
  for(let object=value;object&&object!==Object.prototype&&object!==Function.prototype;object=Object.getPrototypeOf(object)){
   for(const [key,descriptor] of Object.entries(Object.getOwnPropertyDescriptors(object)))if(!descriptors.has(key))descriptors.set(key,descriptor);
  }
  const next=new Set(ancestors);next.add(value);
  for(const [key,descriptor] of descriptors){
   if(typeof value==="function"&&["name","length"].includes(key)&&!descriptor.enumerable)continue;
   if(!identifier.test(key)||excluded.has(key)||key.startsWith("_")||denied?.has(key))continue;
   members.add(key);
   const child=descriptor.value;
   if(child!==null&&typeof child==="object"&&!Array.isArray(child)&&Object.getPrototypeOf(child)===Object.prototype)inspect(name+"."+key,child,next);
  }
  if(members.size)table.set(name,[...members].sort());
 };
 for(const [name,descriptor] of Object.entries(Object.getOwnPropertyDescriptors(context.pine)))if(identifier.test(name)&&!name.startsWith("_"))inspect(name,descriptor.value);
 for(const [name,keys] of nested){
  const members=[...keys].filter(key=>identifier.test(key)&&!excluded.has(key)&&!key.startsWith("_")).sort();
  if(members.length&&table.get(name.split(".")[0])?.includes(name.split(".")[1]))table.set(name,members);
 }
 const namespaces=Object.fromEntries([...table].sort(([a],[b])=>a.localeCompare(b)));
 // Syminfo exports these callable aliases under internal transpiler names.
 // The actual Pine namespace members are ticker/prefix, already in ISymbolInfo.
 if(!namespaces["chart.point"]?.includes("new")||!namespaces.math?.includes("abs")||!namespaces.syminfo?.includes("ticker"))throw new Error("Incomplete initialized Pine namespace inventory.");
 return {...provenance(sources,manifest),namespaces,membersSha256:digest(JSON.stringify(namespaces))};
}
export function verifyNamespaceMembers(inventory,sources,manifest){
 if(!inventory||typeof inventory!=="object"||Array.isArray(inventory))throw new Error("Invalid Pine namespace inventory.");
 const expected=provenance(sources,manifest);
 for(const [key,value] of Object.entries(expected))if(JSON.stringify(inventory[key])!==JSON.stringify(value))throw new Error("Pine namespace inventory provenance mismatch: "+key);
 if(!inventory.namespaces||typeof inventory.namespaces!=="object"||Array.isArray(inventory.namespaces))throw new Error("Invalid Pine namespace inventory.");
 for(const [name,members] of Object.entries(inventory.namespaces)){
  if(!name.split(".").every(part=>identifier.test(part))||!Array.isArray(members)||!members.length||members.some(member=>typeof member!=="string"||!identifier.test(member)||excluded.has(member)||member.startsWith("_"))||JSON.stringify(members)!==JSON.stringify([...new Set(members)].sort()))throw new Error("Invalid Pine namespace member list: "+name);
 }
 if(digest(JSON.stringify(inventory.namespaces))!==inventory.membersSha256)throw new Error("Pine namespace inventory member digest mismatch.");
 return inventory.namespaces;
}
export function readPineNamespaceMembers({vendorRoot=defaultVendor,sources,manifest}={}){
 if(!sources||!manifest)({sources,manifest}=inputs(vendorRoot));
 return verifyNamespaceMembers(JSON.parse(fs.readFileSync(path.join(vendorRoot,"namespace-members.json"),"utf8")),sources,manifest);
}
export const pineNamespaceMemberExpression=namespaces=>JSON.stringify(namespaces);

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const check=process.argv.includes("--check");
 if(process.argv.slice(2).some(arg=>arg!=="--check"))throw new Error("Usage: node scripts/pine-namespace-members101.mjs [--check]");
 const inventory=await generatePineNamespaceMembers();
 const text=JSON.stringify(inventory,null,2)+"\n",target=path.join(defaultVendor,"namespace-members.json");
 if(check){if(fs.readFileSync(target,"utf8")!==text)throw new Error("Pine namespace inventory is stale; regenerate it.");}
 else fs.writeFileSync(target,text);
 console.info(JSON.stringify({checked:check,namespaces:Object.keys(inventory.namespaces).length,members:Object.values(inventory.namespaces).reduce((count,members)=>count+members.length,0),jsonBytes:Buffer.byteLength(text),compactExpressionBytes:Buffer.byteLength(pineNamespaceMemberExpression(inventory.namespaces)),sha256:digest(text)}));
}
