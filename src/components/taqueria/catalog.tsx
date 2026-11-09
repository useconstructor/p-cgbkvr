"use client";
import { useState } from "react";
import { Check, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOrder } from "./order-provider";
import { Price, ProductImage } from "./shared";
import type { Product } from "@/lib/order-types";
const fold = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
export function Catalog({ selectedId, choose, compact = false }: { selectedId?: string; choose?: (product: Product) => void; compact?: boolean }) {
  const { menu, menuLoading, menuError, loadMenu, add, pending, issue, cart } = useOrder();
  const [search, setSearch] = useState(""), [category, setCategory] = useState("all");
  const products = menu?.products.filter(p => (category === "all" || p.categoryId === category) && fold(`${p.name} ${p.description}`).includes(fold(search))) || [];
  return <section className={`catalog ${compact ? "catalog-compact" : ""}`} aria-label="Carta" id="carta"><div className="catalog-heading"><div><h2 tabIndex={-1} id="carta-titulo">Nuestro menú</h2><p>Elige tus favoritos y hazlo a tu gusto.</p></div><span className="menu-count">{menu ? `${menu.products.length} para elegir` : "Tacos y bebidas"}</span></div>
    <div className="catalog-tools"><form className="search-form" role="search" onSubmit={e => e.preventDefault()}><label htmlFor={compact ? "buscar-pedido" : "buscar-menu"}>Buscar productos</label><div className="search-input"><Search size={20} aria-hidden="true" /><input id={compact ? "buscar-pedido" : "buscar-menu"} type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Por nombre o ingrediente…" /></div></form><div className="category-filters" role="group" aria-label="Filtrar por categoría">{[{ id: "all", name: "Todo" }, ...(menu?.categories || [{ id: "tacos", name: "Tacos" }, { id: "bebidas", name: "Bebidas" }])].map(c => <Button key={c.id} className="filter-button" variant="outline" aria-pressed={category === c.id} onClick={() => setCategory(c.id)}>{c.name}</Button>)}</div></div>
    {menuLoading && !menu && <div role="status" className="catalog-loading">Cargando productos y precios…</div>}
    {menuError && <div className="recovery-panel"><p role="alert">{menuError}</p><Button className="action secondary" onClick={() => void loadMenu()}>Reintentar menú</Button></div>}
    {menu && !products.length && <div className="empty-results"><h3>No encontramos productos</h3><p>Prueba otra búsqueda o limpia los filtros.</p><Button className="action secondary" onClick={() => { setSearch(""); setCategory("all"); }}>Limpiar filtros</Button></div>}
    {menu?.categories.map(group => {
      const entries = products.filter(product => product.categoryId === group.id);
      if (!entries.length) return null;
      return <section key={group.id} className={`menu-category menu-category-${group.id}`} aria-label={group.name}>
        <h3 className="category-heading">{group.name}</h3>
        <ul className="menu-list">{entries.map(product => <li key={product.id} data-product-id={product.id} className={selectedId === product.id ? "menu-entry is-selected" : "menu-entry"}><ProductImage resource={product.resource} name={product.name} /><div className="menu-entry-copy"><h3>{product.name}</h3><p>{product.description}</p><Price cents={product.priceCents} /><div className="entry-actions">{choose && <Button className="choose-button" variant="ghost" aria-label={`Elegir ${product.name}`} aria-pressed={selectedId === product.id} onClick={() => choose(product)}>{selectedId === product.id ? <><Check size={15} />Elegido</> : "Elegir"}</Button>}<Button className="add-button" variant="outline" aria-label={`Añadir ${product.name}`} focusableWhenDisabled disabled={pending || !!issue || cart?.status === "confirmed" || cart?.status === "replaced"} onClick={() => void add(product)}>Añadir <Plus size={16} /></Button></div></div></li>)}</ul>
      </section>;
    })}
    {cart && cart.status !== "open" && <p className="closed-note">Tu pedido está guardado. Empieza un <a href="/pedido">nuevo pedido</a> para añadir productos.</p>}
  </section>;
}
