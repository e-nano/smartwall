import {test} from "node:test";
import assert from "node:assert/strict";
import {componentCategoryPath,childTypeOptions} from "../src/categoryPaths.js";

test("legacy classifications remain readable and arbitrary-depth paths are preserved",()=>{
  assert.deepEqual(componentCategoryPath({category:"Electronics",subcategory:"Sensors"}),["Electronics","Sensors"]);
  const path=["Electronics","Passive",...Array.from({length:120},(_,index)=>`Subtype ${index}`)];
  assert.deepEqual(componentCategoryPath({category:"Electronics",subcategory:"Passive",category_path_json:JSON.stringify(path)}),path);
});
test("nested suggestions belong to the full parent path and do not mix branches",()=>{
  const paths=[["Electronics","Passive","Resistors","Metal film"],["Electronics","Passive","Resistors","Carbon film"],["Electronics","Passive","Capacitors"],["Mechanics","Passive","Resistors","Unrelated"]];
  assert.deepEqual(childTypeOptions(paths,["Electronics","Passive","Resistors"]),[{value:"Carbon film"},{value:"Metal film"}]);
  assert.deepEqual(childTypeOptions(paths,["New category"]),[]);
});
