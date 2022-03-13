const fs = require("fs");
const jsonexport = require("jsonexport");

function parseJsonToCsv(jsonFile, csvFile) {
  const rawdata = fs.readFileSync(jsonFile);
  const data = JSON.parse(rawdata);

  const today = new Date();
  const startDate = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - 7
  );
  const endDate = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() + 1
  );

  function mapListTitleToActon(data) {
    return action => {
      const listId =
        data.cards.find(c => c.id === action.data.card.id)?.idList ?? null;
      const listName = listId
        ? data.lists.find(l => l.id === listId).name
        : `no list found (${action.data.card.name})`;
      return { ...action, data: { ...action.data, list: listName } };
    };
  }

  function mapChecklistProgress(data) {
    return action => {
      const checklists = data.checklists
        .filter(c => c.name === "Main")
        .find(c => c.idCard === action.data.card.id);
      const checkItems = checklists ? checklists.checkItems : [];
      const progress =
        Math.round(
          (checkItems.filter(c => c.state === "complete").length /
            checkItems.length) *
            100
        ) / 100;
      return { ...action, data: { ...action.data, progress } };
    };
  }

  function filterForCheckCompletedItems(action) {
    return (
      action.type === "updateCheckItemStateOnCard" &&
      action.data.checkItem.state === "complete"
    );
  }

  function filterCommentCardItems(action) {
    return action.type === "commentCard";
  }
  function populateCheckCompleted(action) {
    return {
      project: action.data.list,
      member: action.memberCreator.fullName,
      date: action.date,
      item: action.data.card.name,
      progress: action.data.progress,
      done: "✓ " + action.data.checkItem.name,
    };
  }
  function populateCommentCard(action) {
    return {
      project: action.data.list,
      member: action.memberCreator.fullName,
      item: action.data.card.name,
      progress: action.data.progress,
      date: action.date,
      done: (action.data.text.startsWith("-") ? "" : "- ") + action.data.text,
    };
  }

  function filterDateIn(startDate, endDate) {
    return action => {
      const d = new Date(action.date);
      return d > startDate && d < endDate;
    };
  }

  const groupBy = function (data, key) {
    return data.reduce(function (carry, el) {
      var group = el[key];

      if (carry[group] === undefined) {
        carry[group] = [];
      }

      carry[group].push(el);
      return carry;
    }, {});
  };

  const actionsInThisWeek = data.actions
    .filter(a => a.data.card)
    .filter(filterDateIn(startDate, endDate))
    .map(mapListTitleToActon(data))
    .map(mapChecklistProgress(data));

  const actions = [
    ...actionsInThisWeek
      .filter(filterForCheckCompletedItems)
      .map(populateCheckCompleted),
    ...actionsInThisWeek
      .filter(filterCommentCardItems)
      .map(populateCommentCard),
  ]
    .map(action => ({ ...action, date: formatDate(action.date) }))
    .sort(sortByItemName);

  const projects = groupBy(actions, "project");
  const result = Object.keys(projects).reduce((acc, k) => {
    let p = projects[k];
    const itemGroup = groupBy(
      projects[k].map(i => ({
        ...i,
        project: undefined,
      })),
      "item"
    );

    p = Object.keys(itemGroup).reduce((acc2, k2) => {
      if (acc2[k2] === undefined)
        acc2[k2] = {
          progress: itemGroup[k2][0].progress,
          member: itemGroup[k2][0].member,
          done: [],
        };

      acc2[k2].done = itemGroup[k2].map(it => it.done);
      return acc2;
    }, {});

    acc[k] = p;
    return acc;
  }, {});

  console.table(
    actions.map(action => ({ ...action, done: action.done.substr(0, 40) }))
  );

  jsonexport(actions, (err, csv) => {
    if (!err) fs.writeFileSync(csvFile, csv);
  });
}

function sortByItemName(a, b) {
  if (a.item.toUpperCase() < b.item.toUpperCase()) {
    return -1;
  }
  if (a.item.toUpperCase() > b.item.toUpperCase()) {
    return 1;
  }
  return 0;
}

function formatDate(dateString) {
  return dateString.substr(0, 10);
}

parseJsonToCsv("./projects.json", "./projects.csv");
parseJsonToCsv("./rnd.json", "./rnd.csv");
