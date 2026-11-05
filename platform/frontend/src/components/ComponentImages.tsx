import { useState } from "react";
import { Alert, Button, Flex } from "antd";

export function ComponentImages({ value = [], onChange }: { value?: string[]; onChange?: (value: string[]) => void }) {
  const [error,setError] = useState("");
  const [loading,setLoading] = useState(false);
  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(""); setLoading(true);
    try {
      if (value.length+files.length>4) throw new Error("Attach up to four images.");
      if (Array.from(files).some(file => !["image/png","image/jpeg","image/webp"].includes(file.type))) throw new Error("Choose PNG, JPEG or WebP files.");
      const existingBytes = value.reduce((total,image) => total+Math.floor((image.split(",")[1]?.length ?? 0)*3/4),0);
      if (existingBytes+Array.from(files).reduce((total,file) => total+file.size,0)>512*1024) throw new Error("Images must total 512 KiB or less. Resize larger images first.");
      const images = await Promise.all(Array.from(files).map(file => new Promise<string>((resolve,reject) => {
        const reader=new FileReader(); reader.onload=()=>resolve(String(reader.result)); reader.onerror=()=>reject(new Error("Could not read image")); reader.readAsDataURL(file);
      })));
      onChange?.([...value,...images]);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not attach images"); }
    finally { setLoading(false); }
  };
  return <Flex vertical gap={8}>
    <input type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={loading} aria-label="Attach component images"
      onChange={event => { void add(event.target.files); event.target.value=""; }} />
    <span>Up to four images, 512 KiB total.</span>
    <Flex gap={12} wrap="wrap">{value.map((image,index) => <Flex key={index} vertical gap={4}>
      <img src={image} alt={`Component attachment ${index+1}`} width={90} height={90} style={{ objectFit: "contain" }} />
      <Button onClick={()=>onChange?.(value.filter((_,position)=>position!==index))}>Remove image {index+1}</Button>
    </Flex>)}</Flex>
    {error && <Alert type="error" showIcon title={error} />}
  </Flex>;
}
