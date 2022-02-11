const fs = require("fs");
const jsonexport = require("jsonexport");

const rawdata = fs.readFileSync("./data.json");
const data = JSON.parse(rawdata);

const today = new Date();
const startDate = new Date(
  today.getFullYear(),
  today.getMonth(),
  today.getDate() - 1
);
const endDate = new Date(
  today.getFullYear(),
  today.getMonth(),
  today.getDate() + 1
);

function mapListTitleToActon(data) {
  return action => {
    const listId = data.cards.find(c => c.id === action.data.card.id).idList;
    const listName = data.lists.find(l => l.id === listId).name;
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
      checkItems.filter(c => c.state === "complete").length / checkItems.length;
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
    text: action.data.checkItem.name,
  };
}
function populateCommentCard(action) {
  return {
    project: action.data.list,
    member: action.memberCreator.fullName,
    item: action.data.card.name,
    progress: action.data.progress,
    date: action.date,
    text: action.data.text,
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
  .filter(filterDateIn(startDate, endDate))
  .map(mapListTitleToActon(data))
  .map(mapChecklistProgress(data));

const actions = [
  ...actionsInThisWeek
    .filter(filterForCheckCompletedItems)
    .map(populateCheckCompleted),
  ...actionsInThisWeek.filter(filterCommentCardItems).map(populateCommentCard),
];

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
        text: [],
      };

    acc2[k2].text = itemGroup[k2].map(it => it.text);
    return acc2;
  }, {});

  acc[k] = p;
  return acc;
}, {});

jsonexport(actions, (err, csv) => {
  if (!err) fs.writeFileSync("export.csv", csv);
});
