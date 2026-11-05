import { AutoComplete,Button,Flex,Typography } from "antd";
import { childTypeOptions } from "../categoryPaths";

export function NestedTypes({value=[],onChange,prefix,paths}: {
  value?:string[]; onChange?:(value:string[])=>void; prefix:string[]; paths:string[][];
}) {
  return <Flex vertical gap={10}>
    {value.map((level,index)=><Flex key={index} gap={8} align="center">
      <Typography.Text style={{minWidth:80}}>Subtype {index+1}</Typography.Text>
      <AutoComplete value={level} options={childTypeOptions(paths,[...prefix,...value.slice(0,index)])} maxLength={100}
        style={{flex:1}} placeholder="Choose or enter a subtype" aria-label={`Subtype ${index+1}`}
        onChange={next=>onChange?.(value.map((current,position)=>position===index?next:current))} />
      <Button onClick={()=>onChange?.(value.filter((_,position)=>position!==index))} aria-label={`Remove subtype ${index+1}`}>Remove</Button>
    </Flex>)}
    <Button onClick={()=>onChange?.([...value,""])}>+ Add nested subtype</Button>
  </Flex>;
}
