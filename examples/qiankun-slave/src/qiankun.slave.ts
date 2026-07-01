export default {
  mount(props: { container?: Element | string | null }) {
    console.log("[catalog] mounted by qiankun", props.container);
  },
  unmount() {
    console.log("[catalog] unmounted by qiankun");
  },
};
