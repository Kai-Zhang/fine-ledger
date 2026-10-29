import { useState } from "react";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useApp } from "../ui/context.tsx";
import {
  Header,
  Button,
  IconButton,
  Dialog,
  Field,
} from "../ui/components.tsx";
import { Icon } from "../ui/icons.tsx";
import type { SavedReport } from "../domain/types.ts";
function SavedRow({
  report,
  manage,
  edit,
  remove,
}: {
  report: SavedReport;
  manage: boolean;
  edit: () => void;
  remove: () => void;
}) {
  const app = useApp(),
    sort = useSortable({ id: report.id, disabled: !manage });
  return (
    <div
      className="report-catalog-row"
      ref={sort.setNodeRef}
      style={{
        transform: CSS.Transform.toString(sort.transform),
        transition: sort.transition,
        opacity: sort.isDragging ? 0.4 : 1,
      }}
    >
      {manage && (
        <button
          className="drag-handle"
          aria-label={`排列报表 ${report.name}`}
          {...sort.attributes}
          {...sort.listeners}
        >
          <Icon name="GripVertical" size={18} />
        </button>
      )}
      <button
        className="report-catalog-main"
        onClick={() =>
          manage
            ? edit()
            : app.go({
                page: "report",
                report: report.type,
                savedReportId: report.id,
              })
        }
      >
        <span className="report-type-icon">
          <Icon
            name={report.type === "net" ? "ChartNoAxesCombined" : "ChartPie"}
          />
        </span>
        <span>
          <strong>{report.name}</strong>
          <small>
            {report.type === "net" ? "净值走势" : "支出分类"} ·{" "}
            {report.days === "custom"
              ? `${report.from} — ${report.to}`
              : report.days === "month"
                ? "本月"
                : report.days === "year"
                  ? "今年"
                  : `近 ${report.days} 天`}
          </small>
        </span>
        {!manage && <Icon name="ChevronRight" size={17} />}
      </button>
      {manage && (
        <>
          <IconButton
            name="Pencil"
            label={`更名 ${report.name}`}
            onClick={edit}
          />
          <IconButton
            name="Trash2"
            label={`删除报表 ${report.name}`}
            onClick={remove}
          />
        </>
      )}
    </div>
  );
}
export function ReportCatalog() {
  const app = useApp(),
    reports = app.book.settings.savedReports,
    [manage, setManage] = useState(false),
    [editing, setEditing] = useState<SavedReport | null>(null),
    [name, setName] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  return (
    <>
      <Header title="报表">
        {!!reports.length && (
          <Button variant="plain" onClick={() => setManage(!manage)}>
            {manage ? "完成" : "管理"}
          </Button>
        )}
      </Header>
      <main className="page-content report-catalog">
        {!!reports.length && (
          <>
            <div className="section-title">
              <h2>常用报表</h2>
            </div>
            <DndContext
              accessibility={{
                screenReaderInstructions: {
                  draggable:
                    "按空格开始排序，方向键移动，空格放下，Escape 取消。",
                },
                announcements: {
                  onDragStart: () => "开始排序",
                  onDragOver: ({ over }) =>
                    over ? "已移动到新位置" : "正在移动",
                  onDragEnd: () => "排序完成",
                  onDragCancel: () => "已取消排序",
                },
              }}
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={(e) => {
                if (e.over && e.active.id !== e.over.id)
                  void app.save("排列常用报表", (b) => {
                    const rows = b.settings.savedReports;
                    b.settings.savedReports = arrayMove(
                      rows,
                      rows.findIndex((r) => r.id === e.active.id),
                      rows.findIndex((r) => r.id === e.over!.id),
                    );
                  });
              }}
            >
              <SortableContext
                items={reports.map((r) => r.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="report-catalog-surface">
                  {reports.map((r) => (
                    <SavedRow
                      key={r.id}
                      report={r}
                      manage={manage}
                      edit={() => {
                        setEditing(r);
                        setName(r.name);
                      }}
                      remove={async () => {
                        if (
                          await app.confirm({
                            title: "删除常用报表？",
                            message: `只删除“${r.name}”的筛选配置，交易不会被删除。`,
                            label: "删除",
                            danger: true,
                          })
                        )
                          await app.save("删除常用报表", (b) => {
                            b.settings.savedReports =
                              b.settings.savedReports.filter(
                                (x) => x.id !== r.id,
                              );
                          });
                      }}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </>
        )}
        <div className="section-title">
          <h2>报表类型</h2>
        </div>
        <div className="report-catalog-surface">
          {(
            [
              ["net", "净值走势", "ChartNoAxesCombined"],
              ["expense", "支出分类", "ChartPie"],
            ] as const
          ).map(([type, label, icon]) => (
            <div className="report-catalog-row" key={type}>
              <button
                className="report-catalog-main"
                onClick={() => app.go({ page: "report", report: type })}
              >
                <span className="report-type-icon">
                  <Icon name={icon} />
                </span>
                <strong>{label}</strong>
                <Icon name="ChevronRight" size={17} />
              </button>
            </div>
          ))}
        </div>
      </main>
      {editing && (
        <Dialog
          title="报表名称"
          dirty={name !== editing.name}
          onClose={() => setEditing(null)}
        >
          <form
            className="dialog-body"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                name.trim() &&
                (await app.save("更名常用报表", (b) => {
                  const r = b.settings.savedReports.find(
                    (r) => r.id === editing.id,
                  );
                  if (r) r.name = name.trim();
                }))
              )
                setEditing(null);
            }}
          >
            <Field label="名称">
              <input
                autoFocus
                required
                maxLength={40}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <div className="dialog-footer">
              <Button type="submit">保存</Button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
