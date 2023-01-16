import axios, { AxiosRequestConfig } from "axios";
import { writeFileSync } from "fs";
import jsonexport from "jsonexport";
import { config } from "dotenv";
config();

type Item = {
  board: string;
  project: string;
  item: string;
  todos: string;
  done: string;
  date: string;
  member: string;
  progress: number;
  additionalRate: number;
};
type ItemContainer = {
  board: string;
  data: Item[];
};

function filterDateIn(startDate: Date, endDate: Date) {
  return (action: { date: string }) => {
    const d = new Date(action.date);
    return d > startDate && d < endDate;
  };
}

function sortByItemName(a: Item, b: Item) {
  if (a.item?.toLowerCase() < b.item?.toLowerCase()) {
    return -1;
  }
  if (a.item?.toLowerCase() > b.item?.toLowerCase()) {
    return 1;
  }
  return 0;
}

function formatDate(dateString: string) {
  return dateString.substring(0, 9);
}

function writeJsonToCsv(actions: Item[][], csvFile: string) {
  const options = {
    headers: [
      "project",
      "member",
      "item",
      "progress",
      "date",
      "done",
      "todos",
      "additionalRate"
    ]
  };

  jsonexport(actions, options, (err: Error, csv: string) => {
    if (!err) writeFileSync(csvFile, csv);
  });
}

function reduceActionsAsSummary(acc: Item[], data: Item) {
  const existingDataIndex = acc.findIndex(
    d => d.project === data.project && d.item === data.item
  );
  if (existingDataIndex > -1) {
    const prevDone = (acc[existingDataIndex].done ?? "") + "\n";
    acc[existingDataIndex].done = prevDone + data.done;
  } else {
    acc.push(data);
  }
  return acc;
}

function reduceTodosOnActions(actions: Item[], todoData: Item) {
  const existingActionIndex = actions.findIndex(
    d => d.project === todoData.project && d.item === todoData.item
  );

  if (existingActionIndex > -1) {
    actions[existingActionIndex].date = todoData.date;
    const prevTodos = (actions[existingActionIndex].todos ?? "") + "\n";
    actions[existingActionIndex].todos = prevTodos + todoData.todos;
  } else {
    actions.push(todoData);
  }
  return actions;
}

const mapTitleAndProgress =
  (prop: keyof Item, showProgress = true) =>
  (data: Item) => {
    let title = `[${data.item.replace(/P\d+ /, "")}]`;
    if (showProgress)
      title += `진행률 ${isNaN(data.progress) ? 0 : data.progress * 100}% `;

    if (data[prop] && !(data[prop] as string)?.includes(title)) {
      (data[prop] as string) = title + "\n" + (data[prop] ?? "");
    }
    return data;
  };

const readline = require("readline").createInterface({
  input: process.stdin,
  output: process.stdout
});

readline.question("Input day offset. (default: 7)", (offsetDate = "7") => {
  const today = new Date();
  const offsetDay = offsetDate ? Number(offsetDate) : 7;
  const startDate = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - offsetDay
  );
  const endDate = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() + 1
  );
  const todayDate = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );

  const url = "https://api.trello.com/1";
  const actionTypes = ["updateCheckItemStateOnCard" /*, "commentCard" */];
  const key = process.env.key;
  const token = process.env.token;
  if (!key || !token) {
    console.error("key and token have to be given.");
    readline.close();
    return;
  }
  const sufix = `key=${key}&token=${token}`;
  const filterOutLabels = ["canceled", "pending", "done"];
  const axiosConfig = { baseURL: url } as AxiosRequestConfig;
  const client = axios.create(axiosConfig);
  console.log("Axios baseUrl: ", axiosConfig.baseURL);
  client
    .get(`/members/me/boards?fields=name,url&` + sufix)
    .then(async res => {
      const boardData = res.data.filter((b: any) =>
        ["newmedia.projects", "newmedia.r&d"].includes(b.name.toLowerCase())
      );

      console.log(
        "boardData ",
        boardData.map((x: any) => x.name)
      );

      const allTodoLists: ItemContainer[] = [];
      const allActionLists: ItemContainer[] = [];
      console.log("=============================");
      console.log("Getting todolists");
      for (const { name, id } of boardData) {
        console.log("fetching all cards of board ", name);
        let todosPerCards: Item[] = [];
        try {
          const { data: allCards } = await client.get(
            `/boards/${id}/cards?filter=open&${sufix}`
          );
          console.log("all cards count", allCards.length);
          for (const card of allCards) {
            console.log(
              `==== card.name: ${card.name} labels: ${card.labels
                .map((l: any) => l.name)
                .join(", ")} ====`
            );
            if (
              !card.idChecklists.length ||
              card.labels.filter((l: any) =>
                filterOutLabels.includes(l.name.toLowerCase())
              ).length > 0
            )
              continue;

            const { data: list } = await client.get(
              `/lists/${card.idList}?${sufix}`
            );
            if (list.name.toLowerCase().startsWith("how to use")) continue;

            const { data: members } = await client.get(
              `/cards/${card.id}/members?${sufix}`
            );

            const { data: checklists } = await client.get(
              `/cards/${card.id}/checklists?${sufix}`
            );

            const checklistItemsFilter = (c: any) =>
              !c.name.trim().startsWith("---") &&
              !c.name.trim().startsWith("===");

            const mainCheckLists = checklists
              .filter((cl: any) =>
                cl.name.toLowerCase().trim().startsWith("main")
              )
              .map((cl: any) => ({
                ...cl,
                checkItems: cl.checkItems.filter(checklistItemsFilter)
              }));

            let todoCheckLists = [];
            if (!mainCheckLists.length) {
              console.warn(
                "no todo-list found in main checkItems. getting from todo-list..."
              );
            } else {
              console.log(
                mainCheckLists.reduce(
                  (a: any, x: any) => a + x.checkItems.length,
                  0
                ),
                " todo-list found in main-list checkItems"
              );
            }
            todoCheckLists = checklists
              .filter((cl: any) =>
                cl.name.trim().toLowerCase().startsWith("todo")
              )
              .map((cl: any) => ({
                ...cl,
                checkItems: cl.checkItems.filter(checklistItemsFilter)
              }));
            if (todoCheckLists.length) {
              console.log(
                todoCheckLists.reduce(
                  (a: any, x: any) => a + x.checkItems.length,
                  0
                ),
                " todo-list found in todo-list checkItems"
              );
            }

            const checkListItemsCount = [...mainCheckLists, ...todoCheckLists]
              .map(cl => cl.checkItems)
              .reduce(
                (acc, checkItems) => ({
                  completed:
                    acc.completed +
                    checkItems.filter((ci: any) => ci.state === "complete")
                      .length,
                  total: acc.total + checkItems.length,
                  additional:
                    acc.additional +
                    checkItems.filter((ci: any) =>
                      ci.name.trim().startsWith("+")
                    ).length
                }),
                {
                  completed: 0,
                  total: 0,
                  additional: 0
                }
              );

            const progress =
              Math.round(
                (checkListItemsCount.completed / checkListItemsCount.total) *
                  100
              ) / 100;
            const additionalRate =
              Math.round(
                (checkListItemsCount.additional / checkListItemsCount.total) *
                  100
              ) / 100;

            console.log(
              `\t${card.name} progress: ${progress * 100}% <- ${
                checkListItemsCount.completed
              }/${checkListItemsCount.total} (+${additionalRate}% <- ${
                checkListItemsCount.additional
              })`
            );

            const todoItem = [...mainCheckLists, ...todoCheckLists]
              .map(cl =>
                cl.checkItems.filter((c: any) => c.state !== "complete")
              )
              .reduce(
                (acc, checkItems) => ({
                  ...acc,
                  todos: [...acc.todos, ...checkItems]
                }),
                {
                  board: name,
                  project: list.name,
                  item: card.name,
                  member: members.map((m: any) => m.fullName).join(", "),
                  date: formatDate(today.toISOString()),
                  progress,
                  additionalRate,
                  todos: []
                }
              );

            todoItem.todos = todoItem.todos
              .sort((a: any, b: any) => (a.name > b.name ? 1 : -1))
              .map((c: any) => `→ ${c.name}`)
              .join("\n");

            todosPerCards.push(todoItem);
          }
          allTodoLists.push({ board: name, data: todosPerCards });
        } catch (e) {
          /* handle error */
          console.error(e);
        }

        console.log("=============================");
        console.log("Getting actions");
        try {
          const { data: actionsFetched } = await client.get(
            `/boards/${id}/actions?filter=${actionTypes.join(",")}&${sufix}`
          );
          const actionLists: Item[] = [];
          for (const action of (await actionsFetched)
            .filter(filterDateIn(startDate, endDate))
            .filter(
              (a: { type: string; data: { checkItem: { state: string } } }) =>
                a.type === "updateCheckItemStateOnCard"
                  ? a.data.checkItem.state === "complete"
                  : true
            )) {
            console.log(
              action.data.card.name,
              "parsing action of type",
              action.type
            );
            const card = action.data.card;
            const { data: list } = await client.get(
              `/cards/${card.id}/list?${sufix}`
            );
            // const { data: member } = await client.get(
            //   `/actions/${action.id}/memberCreator?${sufix}`
            // );

            const matchingTodoData = todosPerCards.filter(
              d => d.item === card.name
            );

            const progress: number =
              matchingTodoData.length > 0 ? matchingTodoData[0].progress : 0.0;

            const d = {
              board: name,
              project: list.name,
              member: action.memberCreator.fullName,
              item: card.name,
              progress,
              additionalRate: 0,
              date: formatDate(action.date),
              done: "✓ " + action.data.checkItem.name,
              todos: ""
            };

            actionLists.push(d);
          }
          allActionLists.push({
            board: name,
            data: actionLists
          });
        } catch (e) {
          /* handle error */
          console.error(e);
          continue;
        }
      }

      return [allActionLists, allTodoLists];
    })
    .then(([doneList, todoList]) => {
      const output = [
        ...doneList.map(({ data }) => data.sort(sortByItemName)),
        ...todoList.map(({ data }) => data.sort(sortByItemName))
      ];
      console.log("writing data to output.csv");
      writeJsonToCsv(output, "./output.csv");

      const doneListReduced = doneList
        .reduce((a, { data }) => [...a, ...data], [] as Item[])
        .reduce(reduceActionsAsSummary, [])
        .map(mapTitleAndProgress("done", false));

      const outputOfSummary = [
        ...todoList.map(({ board, data }) =>
          data
            .reduce(reduceTodosOnActions, [
              ...doneListReduced.filter(a => a.board === board)
            ])
            .map(mapTitleAndProgress("todos"))
            .sort(sortByItemName)
        )
      ];

      console.log("writing summary data to output-summary.csv");
      writeJsonToCsv(outputOfSummary, "./output-summary.csv");

      console.log("=============================");
      console.log("FINISHED");
    })
    .catch(console.error);

  readline.close();
});
