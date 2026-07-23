"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { motion, useReducedMotion } from "motion/react";
import { isNoneCategoryStored } from "@/lib/categories";
import { reorderClosetGroupItems } from "@/lib/actions/closetGroupOrder";
import { itemTileImageTransform } from "@/lib/item-tile-meta";
import {
  closetGroupKey,
  groupItemIds,
  itemsShareClosetGroup,
  reorderIdList,
} from "@/lib/closet-group-order";
import { sortWardrobeItems, type ClosetSortKey, type SortOrders } from "@/lib/closet-sort";
import { thumbnailUrl } from "@/lib/image-paths";
import { springSoft, staggerFast, staggerItem } from "@/lib/ui-motion";

export type ClosetGridItem = {
  id: string;
  name: string;
  brand: string | null;
  category: string;
  colors: string;
  imagePath: string;
  thumbZoom: number;
  mirror: boolean;
  isWishlist: boolean;
  createdAt: string;
  priceCents: number | null;
  season: string;
};

type Props = {
  items: ClosetGridItem[];
  sort: ClosetSortKey;
  sortOrders: SortOrders;
  noneCategoryLabel: string;
};

export function ClosetGrid({ items: initialItems, sort, sortOrders, noneCategoryLabel }: Props) {
  const [items, setItems] = useState(initialItems);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [shakeId, setShakeId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const dropAcceptedRef = useRef(false);
  const invalidHoverRef = useRef(false);
  const suppressNavRef = useRef(false);
  const itemsById = useRef(new Map(initialItems.map((i) => [i.id, i])));

  useEffect(() => {
    setItems(initialItems);
    itemsById.current = new Map(initialItems.map((i) => [i.id, i]));
  }, [initialItems]);

  const reduce = useReducedMotion();

  function toSortable(list: ClosetGridItem[]) {
    return list.map((i) => ({
      ...i,
      createdAt: new Date(i.createdAt),
    }));
  }

  function resort(list: ClosetGridItem[], groupOrders: SortOrders["closetGroupOrders"]) {
    return sortWardrobeItems(toSortable(list), sort, {
      ...sortOrders,
      closetGroupOrders: groupOrders,
    }).map((i) => ({
      ...i,
      createdAt: i.createdAt.toISOString(),
    }));
  }

  function triggerShake(id: string) {
    setShakeId(id);
    window.setTimeout(() => setShakeId((cur) => (cur === id ? null : cur)), 380);
  }

  function handleDragStart(itemId: string) {
    dropAcceptedRef.current = false;
    invalidHoverRef.current = false;
    suppressNavRef.current = true;
    setDraggedId(itemId);
  }

  function handleDragEnd(itemId: string) {
    if (!dropAcceptedRef.current && invalidHoverRef.current) triggerShake(itemId);
    invalidHoverRef.current = false;
    setDraggedId(null);
    setDropTargetId(null);
    window.setTimeout(() => {
      suppressNavRef.current = false;
    }, 0);
  }

  function handleDragOver(e: React.DragEvent, targetId: string) {
    if (!draggedId || draggedId === targetId) return;
    const dragged = itemsById.current.get(draggedId);
    const target = itemsById.current.get(targetId);
    if (!dragged || !target) return;
    if (!itemsShareClosetGroup(dragged, target)) {
      invalidHoverRef.current = true;
      setDropTargetId(null);
      return;
    }
    invalidHoverRef.current = false;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTargetId(targetId);
  }

  function handleDrop(e: React.DragEvent, targetId: string) {
    e.preventDefault();
    if (!draggedId || draggedId === targetId) return;
    const dragged = itemsById.current.get(draggedId);
    const target = itemsById.current.get(targetId);
    if (!dragged || !target || !itemsShareClosetGroup(dragged, target)) {
      triggerShake(draggedId);
      invalidHoverRef.current = false;
      return;
    }

    const groupKey = closetGroupKey(dragged.category, dragged.colors);
    const currentGroupIds = groupItemIds(items, groupKey);
    const nextGroupIds = reorderIdList(currentGroupIds, draggedId, targetId);
    if (!nextGroupIds) return;

    dropAcceptedRef.current = true;
    setDraggedId(null);
    setDropTargetId(null);

    const nextOrders = { ...(sortOrders.closetGroupOrders ?? {}), [groupKey]: nextGroupIds };
    const nextItems = resort(items, nextOrders);
    setItems(nextItems);
    itemsById.current = new Map(nextItems.map((i) => [i.id, i]));

    startTransition(async () => {
      await reorderClosetGroupItems(groupKey, nextGroupIds);
    });
  }

  return (
    <motion.ul
      className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-8 2xl:grid-cols-10 gap-4"
      variants={staggerFast}
      initial={reduce ? false : "hidden"}
      animate="show"
    >
      {items.map((item) => {
        const isDragging = draggedId === item.id;
        const isDropTarget = dropTargetId === item.id && draggedId !== item.id;
        const isShaking = shakeId === item.id;
        const categoryLabel = isNoneCategoryStored(item.category)
          ? noneCategoryLabel
          : item.category;

        return (
          <motion.li
            key={item.id}
            layout={!reduce}
            variants={staggerItem}
            whileHover={reduce || isDragging ? undefined : { y: -3, transition: springSoft }}
            className={`rounded-2xl transition ${
              isDragging ? "opacity-45 scale-[0.98]" : ""
            } ${isDropTarget ? "ring-2 ring-accent ring-offset-2 ring-offset-paper" : ""} ${
              isShaking ? "closet-tile-shake" : ""
            }`}
          >
            <div
              draggable
              onDragStart={(e) => {
                handleDragStart(item.id);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", item.id);
              }}
              onDragEnd={() => handleDragEnd(item.id)}
              onDragOver={(e) => handleDragOver(e, item.id)}
              onDragLeave={() => {
                if (dropTargetId === item.id) setDropTargetId(null);
              }}
              onDrop={(e) => handleDrop(e, item.id)}
            >
              <Link
                href={`/closet/${item.id}`}
                draggable={false}
                onClick={(e) => {
                  if (suppressNavRef.current) e.preventDefault();
                }}
                className="block rounded-2xl bg-white shadow-tile overflow-hidden aspect-square relative group focus-visible:ring-2 focus-visible:ring-accent cursor-grab active:cursor-grabbing"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={thumbnailUrl(item.imagePath)}
                  alt={item.name}
                  loading="lazy"
                  className="w-full h-full object-cover pointer-events-none"
                  style={{
                    transform: itemTileImageTransform({
                      thumbZoom: item.thumbZoom,
                      mirror: item.mirror,
                    }),
                  }}
                  draggable={false}
                />
                {item.isWishlist && (
                  <div className="absolute top-2 left-2 right-2 flex items-start justify-between gap-1 pointer-events-none">
                    <span className="bg-white/90 text-ink text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full">
                      Wishlist
                    </span>
                  </div>
                )}
                <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-ink/70 to-transparent text-white opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition pointer-events-none">
                  <div className="text-xs font-medium truncate">{item.name}</div>
                  <div className="text-[10px] text-white/80 truncate">{item.brand ?? "—"}</div>
                  <div className="text-[10px] text-white/70 truncate">{categoryLabel}</div>
                </div>
              </Link>
            </div>
          </motion.li>
        );
      })}
    </motion.ul>
  );
}
