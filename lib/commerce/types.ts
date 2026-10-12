export interface RuntimeEnv {
    DB?: D1Database;
    INVENTORY_KEY?: string;
    BOOTSTRAP_TOKEN?: string;
    DEMO_MODE?: string;
    PAYMENT_WEBHOOK_SECRET?: string;
    PAYMENT_PROVIDER?: string;
    TRON_RECEIVING_ADDRESS?: string;
    TRONGRID_API_KEY?: string;
    USDT_CNY_RATE?: string;
}
export interface Product {
    id: string;
    category_id: string;
    name: string;
    subtitle: string;
    description: string;
    instructions: string;
    price: number;
    compare_price: number;
    min_qty: number;
    max_qty: number;
    featured: number;
    active: number;
    region: string;
    tag: string;
    is_example: number;
    stock: number;
    created_at: number;
}
export interface Category {
    id: string;
    name: string;
    icon: string;
    sort: number;
    active: number;
}
export interface Staff {
    id: string;
    username: string;
    role: string;
    active: number;
    csrf?: string;
}
export interface Order {
    id: string;
    contact: string;
    total: number;
    status: string;
    created_at: number;
    expires_at: number;
    paid_at: number | null;
    demo: number;
    payment?: PaymentInvoice | null;
    items: {
        product_name: string;
        quantity: number;
        price: number;
        product_id: string;
    }[];
    delivery?: string[];
    tickets?: Ticket[];
}
export interface PaymentInvoice {
    id: string;
    order_id: string;
    address: string;
    amount: string;
    base_amount: string;
    adjustment: string;
    rate: string;
    status: string;
    created_at: number;
    pay_before: number;
    watch_until: number;
    tx_id: string | null;
    review_reason: string;
    network: 'TRON / TRC20';
}
export interface Ticket {
    id: string;
    order_id: string;
    subject: string;
    message: string;
    status: string;
    reply: string;
    created_at: number;
}
export interface Catalog {
    products: Product[];
    categories: Category[];
    settings: Record<string, string>;
    demo: boolean;
    paymentEnabled: boolean;
}
