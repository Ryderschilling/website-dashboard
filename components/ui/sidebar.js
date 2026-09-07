"use client";
// Collapsing icon rail, ported from the 21st.dev sidebar to plain JS.
// Same behaviour: 60px rail that expands to 250px on hover, full-screen
// slide-over on mobile. Tab-driven instead of route-driven, so it drops
// straight into the existing single-page dashboard.
import { cn } from "@/lib/utils";
import React, { useState, createContext, useContext } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Menu, X } from "lucide-react";

const SidebarContext = createContext(undefined);

export const useSidebar = () => {
  const context = useContext(SidebarContext);
  if (!context) throw new Error("useSidebar must be used within a SidebarProvider");
  return context;
};

export const SidebarProvider = ({ children, open: openProp, setOpen: setOpenProp, animate = true }) => {
  const [openState, setOpenState] = useState(false);
  const open = openProp !== undefined ? openProp : openState;
  const setOpen = setOpenProp !== undefined ? setOpenProp : setOpenState;
  return (
    <SidebarContext.Provider value={{ open, setOpen, animate }}>
      {children}
    </SidebarContext.Provider>
  );
};

export const Sidebar = ({ children, open, setOpen, animate }) => (
  <SidebarProvider open={open} setOpen={setOpen} animate={animate}>
    {children}
  </SidebarProvider>
);

export const SidebarBody = (props) => (
  <>
    <DesktopSidebar {...props} />
    <MobileSidebar {...props} />
  </>
);

export const DesktopSidebar = ({ className, children, ...props }) => {
  const { open, setOpen, animate } = useSidebar();
  return (
    <motion.div
      className={cn(
        "h-screen sticky top-0 px-3 py-4 hidden md:flex md:flex-col flex-shrink-0 overflow-hidden z-30",
        className
      )}
      style={{ background: "var(--panel)", borderRight: "1px solid var(--border)" }}
      animate={{ width: animate ? (open ? "250px" : "64px") : "250px" }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      {...props}
    >
      {children}
    </motion.div>
  );
};

export const MobileSidebar = ({ className, children, ...props }) => {
  const { open, setOpen } = useSidebar();
  return (
    <div
      className="h-14 px-4 flex flex-row md:hidden items-center justify-between w-full"
      style={{ background: "var(--panel)", borderBottom: "1px solid var(--border)" }}
      {...props}
    >
      <div className="flex justify-end z-20 w-full">
        <Menu
          className="cursor-pointer"
          style={{ color: "var(--text)" }}
          onClick={() => setOpen(!open)}
          aria-label="Open menu"
        />
      </div>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ x: "-100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "-100%", opacity: 0 }}
            transition={{ duration: 0.28, ease: "easeInOut" }}
            className={cn("fixed h-full w-full inset-0 p-8 z-[100] flex flex-col justify-between", className)}
            style={{ background: "var(--bg)" }}
          >
            <div
              className="absolute right-8 top-8 z-50 cursor-pointer"
              style={{ color: "var(--text)" }}
              onClick={() => setOpen(!open)}
            >
              <X />
            </div>
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// A nav row. Renders as a button (tab switch) rather than a Link, since the
// dashboard is one page with views.
export const SidebarLink = ({ link, className, active, onSelect }) => {
  const { open, animate } = useSidebar();
  return (
    <button
      type="button"
      onClick={() => onSelect && onSelect(link.key)}
      title={link.label}
      className={cn(
        "flex items-center justify-start gap-3 group/sidebar py-2 px-2 rounded-lg w-full text-left transition-colors",
        className
      )}
      style={{
        background: active ? "var(--panel2)" : "transparent",
        color: active ? "var(--text)" : "var(--muted)",
      }}
    >
      <span className="flex-shrink-0 flex items-center justify-center w-5 h-5">{link.icon}</span>
      <motion.span
        animate={{
          display: animate ? (open ? "inline-block" : "none") : "inline-block",
          opacity: animate ? (open ? 1 : 0) : 1,
        }}
        className="text-[13.5px] font-semibold whitespace-pre inline-block !p-0 !m-0"
      >
        {link.label}
      </motion.span>
      {link.badge != null && (
        <motion.span
          animate={{
            display: animate ? (open ? "inline-block" : "none") : "inline-block",
            opacity: animate ? (open ? 1 : 0) : 1,
          }}
          className="ml-auto text-[11px] font-bold px-1.5 py-0.5 rounded-md"
          style={{ background: "var(--panel2)", color: "var(--muted)" }}
        >
          {link.badge}
        </motion.span>
      )}
    </button>
  );
};
