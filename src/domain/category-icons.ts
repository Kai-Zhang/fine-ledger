import type { Book, Category } from "./types.ts";

const aliases: Record<string, string> = {
  cup: "Utensils",
  train: "TramFront",
  bag: "ShoppingBag",
  home: "House",
  sun: "Sparkles",
  income: "BriefcaseBusiness",
};
const legacyIcons: Record<string, string> = {
  food: "Utensils",
  transport: "TramFront",
  shopping: "ShoppingBag",
  life: "House",
  leisure: "Sparkles",
  earning: "BriefcaseBusiness",
  meal: "Utensils",
  coffee: "Coffee",
  snack: "Carrot",
  metro: "TrainFront",
  taxi: "CarFront",
  ticket: "Plane",
  daily: "Package",
  clothes: "Shirt",
  digital: "Laptop",
  rent: "House",
  service: "Smartphone",
  health: "HeartPulse",
  movie: "Ticket",
  hotel: "Hotel",
  book: "BookOpen",
  salary: "BriefcaseBusiness",
  interest: "Sprout",
  other: "Coins",
};
export function compatibleCategoryIcon(
  category: Pick<Category, "id"> & { icon?: string },
  parentId?: string,
): string {
  if (category.icon && category.icon !== "Tag")
    return aliases[category.icon] || category.icon;
  return legacyIcons[category.id] || legacyIcons[parentId || ""] || "Tag";
}
interface LegacyCategory {
  id: string;
  name: string;
  icon?: string;
  children?: LegacyCategory[];
}
export function repairLegacyCategoryIcons(
  book: Book,
  legacy: { categories?: LegacyCategory[] },
  editedIds = new Set<string>(),
) {
  let count = 0;
  const visit = (source: LegacyCategory, parentId?: string) => {
    const current = book.categories.find((c) => c.id === source.id);
    if (
      current &&
      !editedIds.has(current.id) &&
      current.name === source.name &&
      (current.icon === "Tag" || !current.icon || !!aliases[current.icon])
    ) {
      const icon = compatibleCategoryIcon(current, parentId);
      if (icon !== current.icon) {
        current.icon = icon;
        count++;
      }
    }
    source.children?.forEach((child) => visit(child, source.id));
  };
  legacy.categories?.forEach((category) => visit(category));
  return count;
}
