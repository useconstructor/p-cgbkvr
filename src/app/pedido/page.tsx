import type { Metadata } from "next";
import { OrderPage } from "@/components/taqueria/order-page";
export const metadata: Metadata = { title: "Mi pedido · Taquería Monterey" };
export default function Pedido() { return <OrderPage />; }
