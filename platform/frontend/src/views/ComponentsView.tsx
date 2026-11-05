import { NestedTypes } from "../components/NestedTypes";
import { componentCategoryPath } from "../categoryPaths";
import { ComponentImages } from "../components/ComponentImages";
import { ComponentThumbnail } from "../components/ComponentThumbnail";
import { useEffect, useMemo, useState } from "react";
import { Plus, Tags } from "lucide-react";
import {
  Alert,
  AutoComplete,
  Button,
  Card,
  Col,
  Flex,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Tag,
  Typography
} from "antd";
import type { Part } from "../types";
import type { PartFormValues } from "../uiTypes";
import { generatePartIdentity } from "../componentNaming";
import {
  categoryOptions,
  defaultDiameter,
  defaultLength,
  diameterOptions,
  headTypeOptions,
  lengthOptions,
  measurementSystemOptions,
  subcategoryOptions,
  supportsDiameter,
  supportsHeadType,
  supportsLength
} from "../componentTaxonomy";
import { EmptyState } from "../components/Common";

const { Text } = Typography;
const NOT_APPLICABLE = "Not applicable";

type ClassificationValues = {
  nestedTypes?: string[];
  name: string;
  category: string;
  subcategory: string;
  headType: string;
  measurementSystem: string;
  nominalDiameter: string;
  nominalLength: string;
  accuProductCode: string;
  accuOrderQuantity: number;
};

type ComponentsViewProps = {
  parts: Part[];
  taxonomyParts?: Part[];
  onImages: (partId: string, images: string[]) => Promise<boolean>;
  onCreate: (values: PartFormValues) => Promise<boolean>;
  onClassify: (
    partId: string,
    name: string,
    category: string,
    subcategory: string,
    headType: string,
    measurementSystem: string,
    nominalDiameter: string,
    nominalLength: string,
    accuProductCode: string,
    accuOrderQuantity: number,
    categoryPath: string[]
  ) => Promise<boolean>;
};

function specificationValues(category: string, subcategory: string, measurementSystem = "Metric") {
  const sized = supportsDiameter(category) || supportsLength(category, subcategory);
  const system = sized ? measurementSystem : NOT_APPLICABLE;
  return {
    headType: supportsHeadType(category) ? headTypeOptions(category)[0].value : NOT_APPLICABLE,
    measurementSystem: system,
    nominalDiameter: supportsDiameter(category) ? defaultDiameter(system) : NOT_APPLICABLE,
    nominalLength: supportsLength(category, subcategory) ? defaultLength(system) : NOT_APPLICABLE
  };
}

export function ComponentsView({ parts, taxonomyParts = parts, onCreate, onClassify, onImages }: ComponentsViewProps) {
  const [form] = Form.useForm<PartFormValues>();
  const [classificationForm] = Form.useForm<ClassificationValues>();
  const [imagePart,setImagePart] = useState<Part | null>(null);
  const [imageValues,setImageValues] = useState<string[]>([]);
  const taxonomyPaths=taxonomyParts.map(componentCategoryPath);
  const allCategories = Array.from(new Set([...categoryOptions.map(option=>option.value),...taxonomyParts.map(part=>part.category)])).map(value=>({ value }));
  const allSubcategories = (category: string) => Array.from(new Set([...subcategoryOptions(category).map(option=>option.value),...taxonomyParts.filter(part=>part.category===category).map(part=>part.subcategory)])).map(value=>({ value }));
  const [editingPart, setEditingPart] = useState<Part | null>(null);
  const [partIdOverridden, setPartIdOverridden] = useState(false);
  const [nameOverridden, setNameOverridden] = useState(false);

  const category = Form.useWatch("category", form) ?? "Screws";
  const subcategory = Form.useWatch("subcategory", form) ?? "Socket Cap Screws";
  const measurementSystem = Form.useWatch("measurementSystem", form) ?? "Metric";
  const headType = Form.useWatch("headType", form) ?? "Socket Cap";
  const nominalDiameter = Form.useWatch("nominalDiameter", form) ?? "M5";
  const nominalLength = Form.useWatch("nominalLength", form) ?? "20 mm";
  const createHasHeadType = supportsHeadType(category);
  const createUsesSizing = supportsDiameter(category) || supportsLength(category, subcategory);
  const generatedIdentity = useMemo(
    () => generatePartIdentity({
      category,
      subcategory,
      headType,
      measurementSystem,
      nominalDiameter,
      nominalLength
    }),
    [category, headType, measurementSystem, nominalDiameter, nominalLength, subcategory]
  );

  useEffect(() => {
    if (!partIdOverridden) form.setFieldValue("partId", generatedIdentity.partId);
    if (!nameOverridden) form.setFieldValue("name", generatedIdentity.name);
  }, [form, generatedIdentity, nameOverridden, partIdOverridden]);

  const classificationCategory =
    Form.useWatch("category", classificationForm) ?? editingPart?.category ?? "Other";
  const classificationSubcategory =
    Form.useWatch("subcategory", classificationForm) ?? editingPart?.subcategory ?? "Other";
  const classificationSystem =
    Form.useWatch("measurementSystem", classificationForm) ??
    editingPart?.measurement_system ??
    NOT_APPLICABLE;
  const classificationHeadType =
    Form.useWatch("headType", classificationForm) ?? editingPart?.head_type ?? NOT_APPLICABLE;
  const classificationDiameter =
    Form.useWatch("nominalDiameter", classificationForm) ??
    editingPart?.nominal_diameter ??
    NOT_APPLICABLE;
  const classificationLength =
    Form.useWatch("nominalLength", classificationForm) ??
    editingPart?.nominal_length ??
    NOT_APPLICABLE;
  const classificationHasHeadType = supportsHeadType(classificationCategory);
  const classificationUsesSizing =
    supportsDiameter(classificationCategory) ||
    supportsLength(classificationCategory, classificationSubcategory);
  const classificationGeneratedIdentity = useMemo(
    () => generatePartIdentity({
      category: classificationCategory,
      subcategory: classificationSubcategory,
      headType: classificationHeadType,
      measurementSystem: classificationSystem,
      nominalDiameter: classificationDiameter,
      nominalLength: classificationLength
    }),
    [
      classificationCategory,
      classificationDiameter,
      classificationHeadType,
      classificationLength,
      classificationSubcategory,
      classificationSystem
    ]
  );

  const resetCreateForm = () => {
    const defaults = {
      category: "Screws",
      subcategory: "Socket Cap Screws",
      headType: "Socket Cap",
      measurementSystem: "Metric",
      nominalDiameter: "M5",
      nominalLength: "20 mm"
    };
    setPartIdOverridden(false);
    setNameOverridden(false);
    form.resetFields();
    form.setFieldsValue({
      ...defaults,
      ...generatePartIdentity(defaults),
      accuProductCode: "",
      accuOrderQuantity: 50,
      reorderLevel: 10,
      nestedTypes: []
    });
  };

  const finish = async (values: PartFormValues) => {
    if (await onCreate(values)) resetCreateForm();
  };

  const openClassification = (part: Part) => {
    setEditingPart(part);
    classificationForm.setFieldsValue({
      name: part.name,
      nestedTypes: componentCategoryPath(part).slice(2),
      category: part.category || "Other",
      subcategory: part.subcategory || "Other",
      headType: part.head_type || NOT_APPLICABLE,
      measurementSystem: part.measurement_system || NOT_APPLICABLE,
      nominalDiameter: part.nominal_diameter || NOT_APPLICABLE,
      nominalLength: part.nominal_length || NOT_APPLICABLE,
      accuProductCode: part.accu_product_code || "",
      accuOrderQuantity: part.accu_order_quantity || 0
    });
  };

  const finishClassification = async (values: ClassificationValues) => {
    if (!editingPart) return;
    if (
      await onClassify(
        editingPart.part_id,
        values.name,
        values.category,
        values.subcategory,
        values.headType,
        values.measurementSystem,
        values.nominalDiameter,
        values.nominalLength,
        values.accuProductCode ?? "",
        values.accuOrderQuantity ?? 0,
        [values.category,values.subcategory,...(values.nestedTypes ?? [])]
      )
    ) {
      setEditingPart(null);
    }
  };

  const changeCreateCategory = (nextCategory: string) => {
    const nextSubcategory = subcategoryOptions(nextCategory)[0]?.value ?? "Other";
    form.setFieldsValue({
      subcategory: nextSubcategory,
      ...specificationValues(nextCategory, nextSubcategory)
    });
  };

  const changeCreateSubcategory = (nextSubcategory: string) => {
    const sized = supportsDiameter(category) || supportsLength(category, nextSubcategory);
    const nextSystem = sized
      ? measurementSystem === NOT_APPLICABLE ? "Metric" : measurementSystem
      : NOT_APPLICABLE;
    form.setFieldsValue({
      measurementSystem: nextSystem,
      nominalDiameter: supportsDiameter(category) ? defaultDiameter(nextSystem) : NOT_APPLICABLE,
      nominalLength: supportsLength(category, nextSubcategory) ? defaultLength(nextSystem) : NOT_APPLICABLE
    });
  };

  const changeCreateSystem = (nextSystem: string) => {
    form.setFieldsValue({
      nominalDiameter: supportsDiameter(category) ? defaultDiameter(nextSystem) : NOT_APPLICABLE,
      nominalLength: supportsLength(category, subcategory) ? defaultLength(nextSystem) : NOT_APPLICABLE
    });
  };

  const changeClassificationCategory = (nextCategory: string) => {
    const nextSubcategory = subcategoryOptions(nextCategory)[0]?.value ?? "Other";
    classificationForm.setFieldsValue({
      subcategory: nextSubcategory,
      ...specificationValues(nextCategory, nextSubcategory)
    });
  };

  const changeClassificationSubcategory = (nextSubcategory: string) => {
    const sized =
      supportsDiameter(classificationCategory) ||
      supportsLength(classificationCategory, nextSubcategory);
    const nextSystem = sized
      ? classificationSystem === NOT_APPLICABLE ? "Metric" : classificationSystem
      : NOT_APPLICABLE;
    classificationForm.setFieldsValue({
      measurementSystem: nextSystem,
      nominalDiameter: supportsDiameter(classificationCategory)
        ? defaultDiameter(nextSystem)
        : NOT_APPLICABLE,
      nominalLength: supportsLength(classificationCategory, nextSubcategory)
        ? defaultLength(nextSystem)
        : NOT_APPLICABLE
    });
  };

  const changeClassificationSystem = (nextSystem: string) => {
    classificationForm.setFieldsValue({
      nominalDiameter: supportsDiameter(classificationCategory)
        ? defaultDiameter(nextSystem)
        : NOT_APPLICABLE,
      nominalLength: supportsLength(classificationCategory, classificationSubcategory)
        ? defaultLength(nextSystem)
        : NOT_APPLICABLE
    });
  };

  return (
    <section className="page-content" aria-label="Component catalog">
      <Row gutter={[12, 12]} className="page-row">
        <Col xs={24}>
          <Card title="Add a component" extra={<Plus size={20} />}>
            <Form
              form={form}
              layout="vertical"
              initialValues={{
                category: "Screws",
                subcategory: "Socket Cap Screws",
                headType: "Socket Cap",
                measurementSystem: "Metric",
                nominalDiameter: "M5",
                nominalLength: "20 mm",
                partId: "SCS-M5-20MM",
                name: "M5 x 20 mm Socket Cap Screw",
                accuProductCode: "",
                accuOrderQuantity: 50,
                reorderLevel: 10,
      nestedTypes: []
              }}
              onFinish={(values) => void finish(values)}
              requiredMark={false}
            >
              <Row gutter={12}>
                <Col xs={24} sm={12} xl={createHasHeadType || createUsesSizing ? 6 : 12}>
                  <Form.Item label="Category" name="category" rules={[{ required: true, message: "Choose a category" }]}>
                    <AutoComplete size="large" options={allCategories} onChange={changeCreateCategory} placeholder="Choose or type a new category" maxLength={100} />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12} xl={createHasHeadType || createUsesSizing ? 6 : 12}>
                  <Form.Item label="Type" name="subcategory" rules={[{ required: true, message: "Choose a type" }]}>
                    <AutoComplete size="large" options={allSubcategories(category)} onChange={changeCreateSubcategory} placeholder="Choose or type a new subcategory" maxLength={100} />
                  </Form.Item>
                </Col>
                {createHasHeadType && (
                  <Col xs={24} sm={12} xl={6}>
                    <Form.Item label="Head type" name="headType" rules={[{ required: true }]}>
                      <Select size="large" options={headTypeOptions(category)} />
                    </Form.Item>
                  </Col>
                )}
                {createUsesSizing && (
                  <Col xs={24} sm={12} xl={6}>
                    <Form.Item label="Standard" name="measurementSystem" rules={[{ required: true }]}>
                      <Select size="large" options={measurementSystemOptions} onChange={changeCreateSystem} />
                    </Form.Item>
                  </Col>
                )}
              </Row>

              <Form.Item label="Nested types" name="nestedTypes" rules={[{validator:async(_,levels:string[]|undefined)=>{if(levels?.some(level=>!level.trim())) throw new Error("Name each nested subtype or remove it");}}]}>
                <NestedTypes prefix={[category,subcategory]} paths={taxonomyPaths} />
              </Form.Item>

              <Flex justify="space-between" align="center" className="generated-identity-heading">
                <Text strong>{createUsesSizing ? "Size and generated identity" : "Generated identity"}</Text>
                <Button
                  type="link"
                  onClick={() => {
                    setPartIdOverridden(false);
                    setNameOverridden(false);
                    form.setFieldsValue(generatedIdentity);
                  }}
                >
                  Use generated values
                </Button>
              </Flex>

              <Row gutter={12}>
                {supportsDiameter(category) && (
                  <Col xs={24} sm={12} xl={6}>
                    <Form.Item label="Diameter / thread size" name="nominalDiameter" rules={[{ required: true }]}>
                      <Select showSearch size="large" options={diameterOptions(measurementSystem)} />
                    </Form.Item>
                  </Col>
                )}
                {supportsLength(category, subcategory) && (
                  <Col xs={24} sm={12} xl={6}>
                    <Form.Item label="Length" name="nominalLength" rules={[{ required: true }]}>
                      <Select showSearch size="large" options={lengthOptions(measurementSystem)} />
                    </Form.Item>
                  </Col>
                )}
                <Col xs={24} sm={12} xl={createUsesSizing ? 6 : 12}>
                  <Form.Item
                    label="Part ID"
                    name="partId"
                    extra={partIdOverridden ? "Custom ID" : "Generated automatically"}
                    rules={[{ required: true, message: "Enter a part ID" }]}
                  >
                    <Input size="large" placeholder="SCS-M5-20MM" onChange={() => setPartIdOverridden(true)} />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12} xl={createUsesSizing ? 6 : 12}>
                  <Form.Item
                    label="Name"
                    name="name"
                    extra={nameOverridden ? "Custom name" : "Generated automatically"}
                    rules={[{ required: true, message: "Enter a component name" }]}
                  >
                    <Input
                      size="large"
                      placeholder="M5 x 20 mm Socket Cap Screw"
                      onChange={() => setNameOverridden(true)}
                    />
                  </Form.Item>
                </Col>
              </Row>

              <Row gutter={12}>
                <Col xs={24} lg={16}>
                  <Form.Item label="Description" name="description">
                    <Input.TextArea rows={2} placeholder="A2 stainless steel" />
                  </Form.Item>
                </Col>
                <Col xs={24} lg={8}>
                  <Form.Item
                    label="Reorder at"
                    name="reorderLevel"
                    rules={[{ required: true, message: "Enter a reorder quantity" }]}
                  >
                    <InputNumber size="large" min={0} precision={0} style={{ width: "100%" }} />
                  </Form.Item>
                </Col>
              </Row>

              <Row gutter={12}>
                <Col xs={24} lg={16}>
                  <Form.Item
                    label="Accu product code"
                    name="accuProductCode"
                    extra="Paste the verified Accu code once; SmartWall will reuse it for future orders."
                  >
                    <Input size="large" placeholder="For example: HSH-M5-20-A2" />
                  </Form.Item>
                </Col>
                <Col xs={24} lg={8}>
                  <Form.Item label="Quantity to order" name="accuOrderQuantity">
                    <InputNumber size="large" min={0} precision={0} style={{ width: "100%" }} />
                  </Form.Item>
                </Col>
              </Row>

              <Row gutter={12}>
                <Col xs={24} lg={12}><Form.Item label="Supplier" name="sourceSupplier"><Input maxLength={100} placeholder="For example: RS Components" /></Form.Item></Col>
                <Col xs={24} lg={12}><Form.Item label="Supplier product code" name="sourceProductCode"><Input maxLength={100} /></Form.Item></Col>
                <Col span={24}><Form.Item label="Supplier product link" name="sourceUrl"><Input type="url" maxLength={2000} placeholder="https://…" /></Form.Item></Col>
                <Col span={24}><Form.Item label="Component images" name="images"><ComponentImages /></Form.Item></Col>
              </Row>

              <Row gutter={[12, 12]} align="middle">
                <Col xs={24} lg={16}>
                  <Alert showIcon type="info" message="Use Goods in to resolve supplier labels and confirm unfamiliar products. The first fill learns the actual unit weight from a confirmed piece count." />
                </Col>
                <Col xs={24} lg={8}>
                  <Button block type="primary" size="large" htmlType="submit" icon={<Plus size={18} />}>
                    Add component
                  </Button>
                </Col>
              </Row>
            </Form>
          </Card>
        </Col>

        <Col xs={24}>
          <Card title="Catalog">
            {parts.length === 0 ? (
              <EmptyState title="No matching components" body="Add a component or clear the search." />
            ) : (
              <List
                dataSource={parts}
                renderItem={(part) => (
                  <List.Item
                    actions={[
                      <Button key="classify" size="large" icon={<Tags size={18} />} onClick={() => openClassification(part)}>
                        Classify
                      </Button>,
                      <Button key="images" onClick={()=>{ setImagePart(part); setImageValues(JSON.parse(part.images_json || "[]")); }}>Images</Button>
                    ]}
                    extra={<Statistic value={part.total_quantity} suffix={<small>in stock</small>} />}
                  >
                    <List.Item.Meta
                      avatar={<ComponentThumbnail part={part} />}
                      title={part.name}
                      description={
                        <Flex vertical gap={5}>
                          <Space size={6} wrap>
                            <Tag color="blue">{part.category || "Other"}</Tag>
                            {componentCategoryPath(part).slice(1).map((level,index)=><Tag key={index}>{level}</Tag>)}
                            {part.measurement_system && part.measurement_system !== NOT_APPLICABLE && (
                              <Tag color="cyan">{part.measurement_system}</Tag>
                            )}
                            {part.nominal_diameter && part.nominal_diameter !== NOT_APPLICABLE && (
                              <Tag>{part.nominal_diameter}</Tag>
                            )}
                            {part.nominal_length && part.nominal_length !== NOT_APPLICABLE && (
                              <Tag>{part.nominal_length}</Tag>
                            )}
                            {part.head_type && part.head_type !== NOT_APPLICABLE && (
                              <Tag color="purple">{part.head_type} head</Tag>
                            )}
                            {part.accu_product_code && (
                              <Tag color="green">Accu: {part.accu_product_code}</Tag>
                            )}
                          </Space>
                          {part.source_supplier && <Text type="secondary">{part.source_supplier}: {part.source_product_code}</Text>}
                          {part.source_url && <a href={part.source_url} target="_blank" rel="noopener noreferrer">Supplier product</a>}
                          <Text type="secondary">{part.part_id}</Text>
                          <Text type="secondary" ellipsis>{part.description || "No description"}</Text>
                        </Flex>
                      }
                    />
                  </List.Item>
                )}
              />
            )}
          </Card>
        </Col>
      </Row>

      <Modal title={imagePart ? `Images for ${imagePart.name}` : "Component images"} open={Boolean(imagePart)} onCancel={()=>setImagePart(null)}
        onOk={()=>{ if (imagePart) void onImages(imagePart.part_id,imageValues).then(saved=>{ if(saved) setImagePart(null); }); }} okText="Save images">
        <ComponentImages value={imageValues} onChange={setImageValues} />
      </Modal>

      <Modal
        title={editingPart ? "Classify " + editingPart.name : "Classify component"}
        open={Boolean(editingPart)}
        onCancel={() => setEditingPart(null)}
        onOk={() => classificationForm.submit()}
        okText="Save classification"
        width={640}
        destroyOnHidden
      >
        <Form
          form={classificationForm}
          layout="vertical"
          onFinish={(values) => void finishClassification(values)}
          requiredMark={false}
        >
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="Category" name="category" rules={[{ required: true }]}>
                <AutoComplete size="large" options={allCategories} onChange={changeClassificationCategory} placeholder="Choose or type a new category" maxLength={100} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Type" name="subcategory" rules={[{ required: true }]}>
                <AutoComplete
                  size="large"
                  placeholder="Choose or type a new subcategory"
                  maxLength={100}
                  options={allSubcategories(classificationCategory)}
                  onChange={changeClassificationSubcategory}
                />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label="Nested types" name="nestedTypes" rules={[{validator:async(_,levels:string[]|undefined)=>{if(levels?.some(level=>!level.trim())) throw new Error("Name each nested subtype or remove it");}}]}>
            <NestedTypes prefix={[classificationCategory,classificationSubcategory]} paths={taxonomyPaths} />
          </Form.Item>

          {(classificationHasHeadType || classificationUsesSizing) && (
            <Row gutter={12}>
              {classificationHasHeadType && (
                <Col span={12}>
                  <Form.Item label="Head type" name="headType" rules={[{ required: true }]}>
                    <Select size="large" options={headTypeOptions(classificationCategory)} />
                  </Form.Item>
                </Col>
              )}
              {classificationUsesSizing && (
                <Col span={12}>
                  <Form.Item label="Standard" name="measurementSystem" rules={[{ required: true }]}>
                    <Select size="large" options={measurementSystemOptions} onChange={changeClassificationSystem} />
                  </Form.Item>
                </Col>
              )}
            </Row>
          )}

          {classificationUsesSizing && (
            <Row gutter={12}>
              {supportsDiameter(classificationCategory) && (
                <Col span={12}>
                  <Form.Item label="Diameter / thread size" name="nominalDiameter" rules={[{ required: true }]}>
                    <Select showSearch size="large" options={diameterOptions(classificationSystem)} />
                  </Form.Item>
                </Col>
              )}
              {supportsLength(classificationCategory, classificationSubcategory) && (
                <Col span={12}>
                  <Form.Item label="Length" name="nominalLength" rules={[{ required: true }]}>
                    <Select showSearch size="large" options={lengthOptions(classificationSystem)} />
                  </Form.Item>
                </Col>
              )}
            </Row>
          )}

          <Flex justify="space-between" align="center" className="generated-identity-heading">
            <Text strong>Component name</Text>
            <Button
              type="link"
              onClick={() => classificationForm.setFieldValue("name", classificationGeneratedIdentity.name)}
            >
              Restore generated name
            </Button>
          </Flex>
          <Form.Item
            name="name"
            extra={"Generated from this specification: " + classificationGeneratedIdentity.name}
            rules={[{ required: true, message: "Enter a component name" }]}
          >
            <Input size="large" />
          </Form.Item>

          <Row gutter={12}>
            <Col span={16}>
              <Form.Item
                label="Accu product code"
                name="accuProductCode"
                extra="Copy this from the verified Accu product page."
              >
                <Input size="large" placeholder="Accu product code" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="Quantity to order" name="accuOrderQuantity">
                <InputNumber size="large" min={0} precision={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </section>
  );
}
