import { createLazyRoute } from "@evjs/client/route";
import {
  Alert,
  Button,
  Calendar,
  Card,
  DatePicker,
  Form,
  Input,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";

interface ReleaseRow {
  key: string;
  name: string;
  status: string;
  owner: string;
}

const rows: ReleaseRow[] = [
  { key: "1", name: "SSR document", status: "ready", owner: "Runtime" },
  { key: "2", name: "Route assets", status: "testing", owner: "Bundler" },
  { key: "3", name: "Hydration", status: "ready", owner: "Client" },
];

function AntdPage() {
  return (
    <Space direction="vertical" size="large" style={{ display: "flex" }}>
      <Alert
        showIcon
        message="AntD route chunk"
        description="This route intentionally imports a broad AntD surface to validate that route-level code splitting keeps large UI dependencies out of unrelated SSR documents."
        type="info"
      />

      <Tabs
        items={[
          {
            key: "dashboard",
            label: "Dashboard",
            children: (
              <Card
                title="SSR route asset validation"
                extra={<Button type="primary">Ship</Button>}
              >
                <Space direction="vertical" size="middle">
                  <Typography.Text>
                    The AntD components on this page should live in the `/antd`
                    lazy route chunk.
                  </Typography.Text>
                  <Space wrap>
                    <Tag color="green">SSR</Tag>
                    <Tag color="blue">code splitting</Tag>
                    <Tag color="purple">AntD</Tag>
                  </Space>
                  <DatePicker />
                </Space>
              </Card>
            ),
          },
          {
            key: "form",
            label: "Form",
            children: (
              <Form layout="vertical" style={{ maxWidth: 420 }}>
                <Form.Item label="Owner">
                  <Input placeholder="Runtime team" />
                </Form.Item>
                <Form.Item label="Priority">
                  <Select
                    defaultValue="high"
                    options={[
                      { label: "High", value: "high" },
                      { label: "Medium", value: "medium" },
                      { label: "Low", value: "low" },
                    ]}
                  />
                </Form.Item>
              </Form>
            ),
          },
          {
            key: "calendar",
            label: "Calendar",
            children: <Calendar fullscreen={false} />,
          },
        ]}
      />

      <Table<ReleaseRow>
        pagination={false}
        columns={[
          { dataIndex: "name", title: "Item" },
          {
            dataIndex: "status",
            title: "Status",
            render: (value: string) => (
              <Tag color={value === "ready" ? "green" : "gold"}>{value}</Tag>
            ),
          },
          { dataIndex: "owner", title: "Owner" },
        ]}
        dataSource={rows}
      />
    </Space>
  );
}

export const Route = createLazyRoute("/antd")({
  component: AntdPage,
});
