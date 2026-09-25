function Sidebar({
  activePage,
  setActivePage
}) {

  const menu = [

    {
      id: "overview",
      icon: "⌂",
      label: "Overview",
    },

    {
      id: "ai",
      icon: "◈",
      label: "AI Diagnostics",
    },

    {
      id: "faults",
      icon: "⚠",
      label: "Fault Injection",
    },

    {
      id: "mission",
      icon: "✈",
      label: "Mission Fitness",
    },

  ];


  return (

    <aside className="sidebar">

      <div className="sidebar-title">
        SYSTEM
      </div>


      {menu.map((item) => (

        <button
          key={item.id}
          className={
            activePage === item.id
              ? "nav-button active"
              : "nav-button"
          }
          onClick={() =>
            setActivePage(item.id)
          }
        >

          <span className="nav-icon">
            {item.icon}
          </span>

          {item.label}

        </button>

      ))}


      <div className="sidebar-bottom">

        <div className="system-status">

          <span className="status-dot green" />

          Digital Twin Online

        </div>

        <small>
          AeroSynX v1.0
        </small>

      </div>

    </aside>

  );

}


export default Sidebar;